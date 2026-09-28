// Hyperliquid REST probe: host latency and clock, the perpetual catalog on every perp dex, CCXT 4.5.68's mapping, the bulk anchor calls and how often each field changes, funding, the REST book, and error shapes.
// Public, unauthenticated, read-only: only POST https://api.hyperliquid.xyz/info. Never /exchange, never a signature.
// The documented public budget is 1,200 weight per minute per IP, and most info types weigh 20, so one bulk call a second is the whole budget.
// This script holds itself to SELF_BUDGET weight in any 60 s window, half the published limit, because other probes share the address.
// Run from server/, one mode at a time, at least a minute apart:
//   node --max-old-space-size=512 ../scripts/probes/venues/hyperliquid/rest-probe.mjs <mode>
//   host     DNS, cold and warm exchangeStatus, response headers, clock offset. Weight 22, about 12 s.
//   catalog  meta, perpDexs, allPerpMetas, spotMeta and metaAndAssetCtxs on the first dex: universe fields, delisted flags, szDecimals. Weight 100, about 12 s.
//   ccxt     CCXT loadMarkets with its default options, which paces itself to one weight-20 call a second: market.id, contractSize, HIP-3 bases. Weight about 260, about 15 s.
//   anchor   metaAndAssetCtxs on the first dex once a second for 30 s: change counts per field, oracle tick spacing, premium and funding checks, the engine's 1,000 ppm move guard, the price grid. Weight 600.
//   dexes    allPerpMetas against metaAndAssetCtxs per HIP-3 dex, one call every 2 s. Weight 20 per dex plus 40.
//   funding  predictedFundings, the first dex contexts, perpDexs, and 24 h of fundingHistory on BTC and one HIP-3 coin, each checked against the documented formula. Weight about 102.
//   book     l2Book on a main, a HIP-3, a spot, an unknown and a delisted coin, aggregation, two reads for caching. Weight 20.
//   errors   unknown type, unknown dex, missing field, unknown coin, bad JSON, GET, wrong content type. Weight at most 140.
//   hyperps  perpCategories, perpConciseAnnotations, and two first dex reads 20 s apart for an oracle that holds while the mark moves. Weight 80, about 21 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/hyperliquid/rest.md.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup, resolveCname } from 'node:dns/promises';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'api.hyperliquid.xyz';
const INFO = `https://${HOST}/info`;
const SELF_BUDGET = 600; // weight per rolling 60 s, half of the published 1,200
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

const WEIGHT_2 = new Set(['l2Book', 'allMids', 'clearinghouseState', 'orderStatus', 'spotClearinghouseState', 'exchangeStatus']);
const spent = []; // [ms, weight]
let totalWeight = 0;

async function reserve(weight) {
  for (;;) {
    const now = Date.now();
    while (spent.length && spent[0][0] < now - 60_000) spent.shift();
    const used = spent.reduce((s, [, w]) => s + w, 0);
    if (used + weight <= SELF_BUDGET) break;
    await sleep(spent[0][0] + 60_000 - now + 10);
  }
  spent.push([Date.now(), weight]);
  totalWeight += weight;
}

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

// Weight is reserved before the call from the documented table. Items-based surcharges are added after the reply.
async function info(body, { name, weight, raw, method = 'POST', headers } = {}) {
  const w = weight ?? (WEIGHT_2.has(body?.type) ? 2 : 20);
  await reserve(w);
  const before = Date.now();
  const t0 = performance.now();
  const res = await fetch(INFO, {
    method,
    headers: headers ?? { 'content-type': 'application/json' },
    body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  const after = Date.now();
  if (name) keep(name, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers, before, after };
}

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (arr) => (arr.length ? { n: arr.length, min: Math.min(...arr), median: pct(arr, 50), p90: pct(arr, 90), max: Math.max(...arr) } : { n: 0 });
const hist = (arr) => arr.reduce((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});
const pickHeaders = (h) => Object.fromEntries(h.entries());

async function host() {
  const addrs = await lookup(HOST, { all: true });
  let cname = null;
  try {
    cname = await resolveCname(HOST);
  } catch (e) {
    cname = e.code;
  }
  log('dns', { host: HOST, cname, addresses: addrs.map((a) => a.address) });
  const times = [];
  const bounds = [];
  for (let i = 0; i < 11; i++) {
    const r = await info({ type: 'exchangeStatus' });
    times.push(r.ms);
    const t = Number(r.json?.time);
    if (Number.isFinite(t)) bounds.push({ rtt: r.after - r.before, lo: r.before - t, hi: r.after - t });
    if (i === 0) log('exchangeStatus_first', { status: r.status, ms: r.ms, body: r.text, headers: pickHeaders(r.headers) });
    await sleep(500);
  }
  log('exchangeStatus_warm', stats(times.slice(1)));
  const tight = bounds.sort((a, b) => a.rtt - b.rtt)[0];
  log('clock', { note: 'local minus server time lies between lo and hi, on the call with the smallest round trip', ...tight, samples: bounds.length });
  log('weight', { total: totalWeight });
}

function universeSummary(meta, label) {
  const u = meta?.universe ?? [];
  const keys = hist(u.flatMap((a) => Object.keys(a)));
  return {
    label,
    assets: u.length,
    collateralToken: meta?.collateralToken,
    fieldCounts: keys,
    delisted: u.filter((a) => a.isDelisted).length,
    onlyIsolated: u.filter((a) => a.onlyIsolated).length,
    marginMode: hist(u.map((a) => a.marginMode ?? 'absent')),
    growthMode: hist(u.map((a) => a.growthMode ?? 'absent')),
    szDecimals: hist(u.map((a) => a.szDecimals)),
    maxLeverage: hist(u.map((a) => a.maxLeverage)),
    kPrefixed: u.filter((a) => /^k[A-Z]/.test(a.name)).map((a) => a.name),
    nonAscii: u.filter((a) => /[^\x20-\x7e]/.test(a.name)).map((a) => a.name),
    sample: u.slice(0, 2),
  };
}

async function catalog() {
  const meta = await info({ type: 'meta' }, { name: 'meta.json' });
  log('meta', { status: meta.status, ms: meta.ms, bytes: meta.bytes, ...universeSummary(meta.json, 'first dex') });
  const delisted = (meta.json?.universe ?? []).filter((a) => a.isDelisted).map((a) => a.name);
  log('meta_delisted_names', { count: delisted.length, first: delisted.slice(0, 40) });

  const dexs = await info({ type: 'perpDexs' }, { name: 'perpDexs.json' });
  const list = dexs.json ?? [];
  log('perpDexs', {
    status: dexs.status,
    ms: dexs.ms,
    bytes: dexs.bytes,
    entries: list.length,
    firstEntry: list[0],
    fields: hist(list.filter(Boolean).flatMap((d) => Object.keys(d))),
    dexes: list.filter(Boolean).map((d) => ({
      name: d.name,
      fullName: d.fullName,
      oracleUpdaterIsDeployer: d.oracleUpdater === null || d.oracleUpdater === d.deployer,
      assets: (d.assetToStreamingOiCap ?? []).length,
      fundingMultipliers: hist((d.assetToFundingMultiplier ?? []).map(([, m]) => m)),
    })),
  });

  const all = await info({ type: 'allPerpMetas' }, { name: 'allPerpMetas.json' });
  const arr = Array.isArray(all.json) ? all.json : [];
  log('allPerpMetas', {
    status: all.status,
    ms: all.ms,
    bytes: all.bytes,
    entries: arr.length,
    shapeOfFirst: Array.isArray(arr[0]) ? `array of ${arr[0].length}` : typeof arr[0],
    firstKeys: arr[0] && !Array.isArray(arr[0]) ? Object.keys(arr[0]) : undefined,
    perEntry: arr.map((e, i) => {
      const m = Array.isArray(e) ? e[0] : e;
      const ctxs = Array.isArray(e) ? e[1] : undefined;
      return { i, assets: m?.universe?.length, firstName: m?.universe?.[0]?.name, collateralToken: m?.collateralToken, ctxs: ctxs?.length, delisted: (m?.universe ?? []).filter((a) => a.isDelisted).length };
    }),
  });

  const spot = await info({ type: 'spotMeta' }, { name: 'spotMeta.json' });
  const s = spot.json ?? {};
  log('spotMeta', {
    status: spot.status,
    ms: spot.ms,
    bytes: spot.bytes,
    pairs: s.universe?.length,
    tokens: s.tokens?.length,
    samplePair: s.universe?.slice(0, 2),
    namedPairs: (s.universe ?? []).filter((p) => !p.name.startsWith('@')).map((p) => p.name),
    collateralTokens: [0, 235, 268, 360].map((i) => s.tokens?.find((t) => t.index === i)?.name ?? null),
  });

  const mac = await info({ type: 'metaAndAssetCtxs' }, { name: 'metaAndAssetCtxs.json' });
  const [m, ctxs] = mac.json ?? [];
  const u = m?.universe ?? [];
  const sameAsMeta = u.length === meta.json?.universe?.length && u.every((a, i) => a.name === meta.json.universe[i].name);
  const ctxKeys = hist((ctxs ?? []).flatMap((c) => Object.keys(c)));
  const nulls = {
    midPx: (ctxs ?? []).filter((c) => c.midPx === null).length,
    impactPxs: (ctxs ?? []).filter((c) => c.impactPxs === null).length,
    markPxZero: (ctxs ?? []).filter((c) => Number(c.markPx) === 0).length,
    oraclePxZero: (ctxs ?? []).filter((c) => Number(c.oraclePx) === 0).length,
  };
  const delistedCtx = u.map((a, i) => ({ a, c: ctxs[i] })).filter(({ a }) => a.isDelisted);
  log('metaAndAssetCtxs_first_dex', {
    status: mac.status,
    ms: mac.ms,
    bytes: mac.bytes,
    contentEncoding: mac.headers.get('content-encoding'),
    assets: u.length,
    ctxs: ctxs?.length,
    universeSameOrderAsMeta: sameAsMeta,
    ctxFieldCounts: ctxKeys,
    nulls,
    delistedWithMid: delistedCtx.filter(({ c }) => c.midPx !== null).length,
    delistedSample: delistedCtx.slice(0, 2).map(({ a, c }) => ({ name: a.name, ...c })),
    liveSample: u.slice(0, 1).map((a, i) => ({ name: a.name, ...ctxs[i] })),
  });
  const liveIdx = u.map((a, i) => (a.isDelisted ? -1 : i)).filter((i) => i >= 0);
  priceGrid(liveIdx.map((i) => u[i]), liveIdx.map((i) => ctxs[i]));
  log('weight', { total: totalWeight });
}

async function ccxtMode() {
  const ccxt = require('ccxt');
  const ex = new ccxt.hyperliquid();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.type === 'swap' && m.swap === true && m.active !== false);
  const inactive = all.filter((m) => m.type === 'swap' && m.active === false);
  const hip3 = swaps.filter((m) => m.info?.hip3);
  const main = swaps.filter((m) => !m.info?.hip3);
  const byPair = {};
  for (const m of swaps) (byPair[`${m.base}|${m.quote}`] ??= []).push(m.id);
  const dup = Object.entries(byPair).filter(([, ids]) => ids.length > 1);
  log('ccxt_loadMarkets', {
    version: ccxt.version,
    ms,
    total: all.length,
    byType: hist(all.map((m) => m.type)),
    activeSwaps: swaps.length,
    inactiveSwaps: inactive.length,
    mainDexSwaps: main.length,
    hip3Swaps: hip3.length,
    hip3Dexes: hist(hip3.map((m) => m.info.dex)),
    quotes: hist(swaps.map((m) => m.quote)),
    settles: hist(swaps.map((m) => m.settle)),
    linear: hist(swaps.map((m) => String(m.linear))),
    contractSize: hist(swaps.map((m) => String(m.contractSize))),
    taker: hist(swaps.map((m) => String(m.taker))),
    idEqualsInfoName: swaps.filter((m) => m.id === m.info?.name).length,
    idIsNumeric: swaps.filter((m) => /^\d+$/.test(m.id)).length,
    pairsListedTwice: dup.length,
    pairsListedTwiceSample: dup.slice(0, 10),
    kBases: main.filter((m) => /^k[A-Z]/.test(m.info.name)).map((m) => `${m.info.name}=${m.base}`),
  });
  const show = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, active: m.active, taker: m.taker, amount: m.precision.amount, price: m.precision.price, infoName: m.info.name, dex: m.info.dex ?? '' });
  const pick = ['BTC/USDC:USDC', 'ETH/USDC:USDC', 'HYPE/USDC:USDC', 'KPEPE/USDC:USDC'];
  log('ccxt_samples', { main: pick.map((s) => markets[s]).filter(Boolean).map(show), hip3: Object.entries(hist(hip3.map((m) => m.info.dex))).map(([d]) => show(hip3.find((m) => m.info.dex === d))) });
  log('ccxt_inactive_sample', { names: inactive.slice(0, 10).map((m) => `${m.id}=${m.info.name}`) });
}

// Anchor step: oracle and mark strings keep at most 6 - szDecimals decimals, and the anchor run saw no 5 significant figure limit on them.
// Book tick: order prices also keep at most 5 significant figures, and integers are always allowed (tick-and-lot-size page).
function priceGrid(universe, ctxs) {
  const bookTick = (px, szd) => Math.max(Math.min(10 ** (Math.floor(Math.log10(px)) - 4), 1), 10 ** -(6 - szd));
  const rows = universe.map((a, i) => {
    const px = Number(ctxs[i].markPx);
    return { coin: a.name, anchor: Math.round((10 ** -(6 - a.szDecimals) / px) * 1e6), book: Math.round((bookTick(px, a.szDecimals) / px) * 1e6) };
  });
  const top = (k) => rows.filter((r) => r[k] > 1000).sort((a, b) => b[k] - a[k]).map((r) => `${r.coin}:${r[k]}`);
  log('price_grid_ppm', {
    assets: rows.length,
    anchorStep: stats(rows.map((r) => r.anchor)),
    anchorOver100: rows.filter((r) => r.anchor > 100).length,
    anchorOver1000: top('anchor'),
    bookTick: stats(rows.map((r) => r.book)),
    bookOver100: rows.filter((r) => r.book > 100).length,
    bookOver1000: top('book'),
  });
}

async function anchor() {
  const polls = [];
  const next = Date.now();
  for (let i = 0; i < 30; i++) {
    const at = next + i * 1000;
    const wait = at - Date.now();
    if (wait > 0) await sleep(wait);
    const r = await info({ type: 'metaAndAssetCtxs' });
    const [m, ctxs] = r.json ?? [];
    polls.push({ ms: r.ms, bytes: r.bytes, arrived: r.after, names: m?.universe?.map((a) => a.name), szd: m?.universe?.map((a) => a.szDecimals), delisted: m?.universe?.map((a) => !!a.isDelisted), ctxs, status: r.status });
  }
  log('anchor_timing', { status: hist(polls.map((p) => p.status)), ms: stats(polls.map((p) => p.ms)), bytes: stats(polls.map((p) => p.bytes)) });

  const names = polls[0].names;
  const live = names.map((n, i) => (polls[0].delisted[i] ? -1 : i)).filter((i) => i >= 0);
  const fields = ['oraclePx', 'markPx', 'midPx', 'premium', 'funding', 'openInterest', 'dayNtlVlm'];
  const frac = { oraclePx: [], markPx: [], midPx: [], funding: [], premium: [] };
  for (let k = 1; k < polls.length; k++) {
    for (const f of Object.keys(frac)) {
      const changed = live.filter((i) => polls[k].ctxs[i]?.[f] !== polls[k - 1].ctxs[i]?.[f]).length;
      frac[f].push(Math.round((1000 * changed) / live.length) / 10);
    }
  }
  log('anchor_changed_percent_of_live_assets_per_poll', { liveAssets: live.length, ...frac });

  const oracleTicks = [];
  for (let k = 1; k < polls.length; k++) if (frac.oraclePx[k - 1] > 20) oracleTicks.push(k);
  log('anchor_oracle_tick_polls', { polls: oracleTicks, gaps: oracleTicks.slice(1).map((v, i) => v - oracleTicks[i]) });

  const coins = ['BTC', 'ETH', 'SOL', 'HYPE', 'kPEPE', 'DOGE'];
  const quiet = live.map((i) => ({ i, v: Number(polls[0].ctxs[i].dayNtlVlm) })).sort((a, b) => a.v - b.v).slice(0, 2).map((x) => names[x.i]);
  for (const c of [...coins, ...quiet]) {
    const i = names.indexOf(c);
    if (i < 0) continue;
    const counts = {};
    for (const f of [...fields, 'impactPxs']) {
      let n = 0;
      for (let k = 1; k < polls.length; k++) if (JSON.stringify(polls[k].ctxs[i][f]) !== JSON.stringify(polls[k - 1].ctxs[i][f])) n++;
      counts[f] = n;
    }
    const markEqMid = polls.filter((p) => p.ctxs[i].markPx === p.ctxs[i].midPx).length;
    const oracleSeq = polls.map((p) => p.ctxs[i].oraclePx);
    const changeAt = [];
    for (let k = 1; k < polls.length; k++) if (oracleSeq[k] !== oracleSeq[k - 1]) changeAt.push(k);
    const last = polls.at(-1).ctxs[i];
    log('anchor_coin', { coin: c, polls: polls.length, changes: counts, markEqualsMidPolls: markEqMid, oracleChangePolls: changeAt, longestOracleGapPolls: Math.max(0, ...changeAt.slice(1).map((v, j) => v - changeAt[j])), last, dayNtlVlm: last.dayNtlVlm });
  }

  // premium against the documented impact formula, and funding against the documented clamp, on the last poll
  const last = polls.at(-1).ctxs;
  let premOk = 0;
  let premN = 0;
  const premMiss = [];
  const fundingHist = {};
  let fundingAtInterest = 0;
  let fundingOverCap = 0;
  let markOffOracle = [];
  for (const i of live) {
    const c = last[i];
    fundingHist[c.funding] = (fundingHist[c.funding] ?? 0) + 1;
    if (c.funding === '0.0000125') fundingAtInterest++;
    if (Math.abs(Number(c.funding)) > 0.04) fundingOverCap++;
    markOffOracle.push(Math.abs(Number(c.markPx) / Number(c.oraclePx) - 1));
    if (!c.impactPxs) continue;
    premN++;
    const o = Number(c.oraclePx);
    const [b, a] = c.impactPxs.map(Number);
    const p = (Math.max(b - o, 0) - Math.max(o - a, 0)) / o;
    if (Math.abs(p - Number(c.premium)) < 5e-8) premOk++;
    else if (premMiss.length < 5) premMiss.push({ coin: names[i], premium: c.premium, calc: p, oraclePx: c.oraclePx, impactPxs: c.impactPxs });
  }
  const topFunding = Object.entries(fundingHist).sort((a, b) => b[1] - a[1]).slice(0, 5);
  log('anchor_checks', {
    liveAssets: live.length,
    premiumMatchesImpactFormula: `${premOk} of ${premN}`,
    premiumMisses: premMiss,
    fundingAtInterestOnly: fundingAtInterest,
    fundingOverFourPercent: fundingOverCap,
    commonFunding: topFunding,
    markOffOraclePpm: stats(markOffOracle.map((x) => Math.round(x * 1e6))),
  });

  // price grid: 5 significant figures, at most 6 - szDecimals decimals, integers always allowed (tick-and-lot-size page)
  const decimals = (s) => (s.includes('.') ? s.split('.')[1].replace(/0+$/, '').length : 0);
  const sig = (s) => s.replace('.', '').replace(/^0+/, '').replace(/0+$/, '').length;
  const breaks = { oracleDecimalsOverRule: 0, markDecimalsOverRule: 0, oracleSigOver5: 0, markSigOver5: 0 };
  for (const i of live) {
    const szd = polls[0].szd[i];
    for (const p of polls) {
      const c = p.ctxs[i];
      if (decimals(c.oraclePx) > 6 - szd) breaks.oracleDecimalsOverRule++;
      if (decimals(c.markPx) > 6 - szd) breaks.markDecimalsOverRule++;
      if (sig(c.oraclePx) > 5 && decimals(c.oraclePx) > 0) breaks.oracleSigOver5++;
      if (sig(c.markPx) > 5 && decimals(c.markPx) > 0) breaks.markSigOver5++;
    }
  }
  // the engine's movePpm: the larger of the index and mark moves between two polls, refused above 1,000 ppm
  let transitions = 0;
  let movesOver1000 = 0;
  const movedAssets = new Set();
  const moveMax = [];
  for (const i of live) {
    for (let k = 1; k < polls.length; k++) {
      const a = polls[k - 1].ctxs[i];
      const b = polls[k].ctxs[i];
      const mv = Math.max(Math.abs(b.oraclePx / a.oraclePx - 1), Math.abs(b.markPx / a.markPx - 1)) * 1e6;
      transitions++;
      moveMax.push(Math.round(mv));
      if (mv > 1000) {
        movesOver1000++;
        movedAssets.add(names[i]);
      }
    }
  }
  log('anchor_move_guard', { transitions, movesOver1000, assets: [...movedAssets].slice(0, 25), assetCount: movedAssets.size, movePpm: stats(moveMax.filter((x) => x > 0)) });
  log('anchor_price_rule_breaks', { note: 'asset-polls whose string exceeds the order price rule', ...breaks });
  priceGrid(live.map((i) => ({ name: names[i], szDecimals: polls[0].szd[i] })), live.map((i) => last[i]));
  log('weight', { total: totalWeight });
}

async function dexes() {
  const dexs = await info({ type: 'perpDexs' });
  const names = (dexs.json ?? []).filter(Boolean).map((d) => d.name);
  const t0 = performance.now();
  const all = await info({ type: 'allPerpMetas' });
  const allArr = all.json ?? [];
  log('allPerpMetas_timing', { status: all.status, ms: all.ms, bytes: all.bytes, entries: allArr.length, contentEncoding: all.headers.get('content-encoding'), elapsed: Math.round(performance.now() - t0) });
  const rows = [];
  for (let d = 0; d < names.length; d++) {
    await sleep(2000);
    const r = await info({ type: 'metaAndAssetCtxs', dex: names[d] });
    const [m, ctxs] = r.json ?? [];
    const u = m?.universe ?? [];
    const e = allArr[d + 1];
    const eu = (Array.isArray(e) ? e[0] : e)?.universe ?? [];
    const sameNames = eu.length === u.length && eu.every((a, i) => a.name === u[i].name);
    const liveCtx = (ctxs ?? []).filter((c, i) => !u[i]?.isDelisted);
    rows.push({
      dex: names[d],
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      collateralToken: m?.collateralToken,
      assets: u.length,
      delisted: u.filter((a) => a.isDelisted).length,
      namesMatchAllPerpMetasEntry: sameNames,
      namePrefix: hist(u.map((a) => a.name.split(':')[0])),
      growthMode: hist(u.map((a) => a.growthMode ?? 'absent')),
      markZero: liveCtx.filter((c) => Number(c.markPx) === 0).length,
      oracleZero: liveCtx.filter((c) => Number(c.oraclePx) === 0).length,
      midNull: liveCtx.filter((c) => c.midPx === null).length,
      funding: Object.entries(hist(liveCtx.map((c) => c.funding))).sort((a, b) => b[1] - a[1]).slice(0, 3),
      sample: u.slice(0, 3).map((a, i) => ({ name: a.name, markPx: ctxs[i].markPx, oraclePx: ctxs[i].oraclePx, midPx: ctxs[i].midPx, funding: ctxs[i].funding, premium: ctxs[i].premium })),
    });
  }
  for (const row of rows) log('dex', row);
  log('dex_totals', { dexes: names.length, assets: rows.reduce((s, r) => s + r.assets, 0), delisted: rows.reduce((s, r) => s + r.delisted, 0), perDexMs: stats(rows.map((r) => r.ms)), perDexBytes: rows.reduce((s, r) => s + r.bytes, 0) });
  log('weight', { total: totalWeight });
}

async function funding() {
  const now = Date.now();
  const pf = await info({ type: 'predictedFundings' }, { name: 'predictedFundings.json' });
  const mac = await info({ type: 'metaAndAssetCtxs' });
  const [m, ctxs] = mac.json ?? [];
  const byName = new Map(m.universe.map((a, i) => [a.name, { a, c: ctxs[i] }]));
  const venues = {};
  let hlEqual = 0;
  let hlN = 0;
  const hlDiff = [];
  const nextTimes = {};
  for (const [coin, list] of pf.json ?? []) {
    for (const [venue, v] of list) {
      venues[venue] = (venues[venue] ?? 0) + 1;
      if (v === null) continue;
      if (venue === 'HlPerp') {
        nextTimes[v.nextFundingTime] = (nextTimes[v.nextFundingTime] ?? 0) + 1;
        const x = byName.get(coin);
        if (x) {
          hlN++;
          if (x.c.funding === v.fundingRate) hlEqual++;
          else if (hlDiff.length < 5) hlDiff.push({ coin, ctxFunding: x.c.funding, predicted: v.fundingRate });
        }
      }
    }
  }
  const intervals = {};
  const nulls = {};
  for (const [, list] of pf.json ?? []) {
    for (const [venue, v] of list) {
      if (v === null) {
        nulls[venue] = (nulls[venue] ?? 0) + 1;
        continue;
      }
      const k = v.fundingIntervalHours ?? 'absent';
      (intervals[venue] ??= {})[k] = (intervals[venue][k] ?? 0) + 1;
    }
  }
  const btc = (pf.json ?? []).find(([c]) => c === 'BTC');
  log('predictedFundings', { status: pf.status, ms: pf.ms, bytes: pf.bytes, coins: pf.json?.length, venues, nullsByVenue: nulls, intervalsByVenue: intervals, hlNextFundingTime: nextTimes, lastWholeHour: Math.floor(now / 3_600_000) * 3_600_000, nextWholeHour: Math.ceil(now / 3_600_000) * 3_600_000, ctxFundingEqualsHlPredicted: `${hlEqual} of ${hlN}`, differences: hlDiff, btc });

  // HIP-3 funding: the deployer's multiplier, 8 h interest rate and 8 h clamp from perpDexs, clamp default 0.0003 per the deployer actions page
  const dexs = await info({ type: 'perpDexs' });
  const xyz = (dexs.json ?? []).find((d) => d?.name === 'xyz');
  const param = (list, coin, dflt) => {
    const hit = (list ?? []).find(([c]) => c === coin);
    return hit ? Number(hit[1]) : dflt;
  };
  const hip3 = { multiplier: param(xyz?.assetToFundingMultiplier, 'xyz:XYZ100', 1), interest: param(xyz?.assetToFundingInterestRate, 'xyz:XYZ100', 0.0001), clamp: param(xyz?.assetToFundingClamp, 'xyz:XYZ100', 0.0003) };
  log('hip3_funding_params', { dex: 'xyz', coin: 'xyz:XYZ100', ...hip3, interestEntries: (xyz?.assetToFundingInterestRate ?? []).length, clampEntries: (xyz?.assetToFundingClamp ?? []).length, clampValues: hist((xyz?.assetToFundingClamp ?? []).map(([, v]) => v)), interestValues: hist((xyz?.assetToFundingInterestRate ?? []).map(([, v]) => v)) });

  for (const coin of ['BTC', 'xyz:XYZ100']) {
    const start = now - 24 * 3_600_000;
    const r = await info({ type: 'fundingHistory', coin, startTime: start }, { name: `fundingHistory-${coin.replace(':', '_')}.json` });
    const rows = Array.isArray(r.json) ? r.json : [];
    const extra = Math.floor(rows.length / 20); // documented surcharge of one weight per 20 items
    spent.push([Date.now(), extra]);
    totalWeight += extra;
    const offsets = rows.map((x) => x.time % 3_600_000);
    const gaps = rows.slice(1).map((x, i) => x.time - rows[i].time);
    // documented: F8 = P + clamp(0.0001 - P, -0.0005, 0.0005), paid hourly at F8 / 8
    const tests = rows.map((x) => {
      const P = Number(x.premium);
      const F = Number(x.fundingRate);
      const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
      return {
        eighthOfF8: Math.abs((P + clamp(0.0001 - P, -0.0005, 0.0005)) / 8 - F) < 1e-9,
        premiumPlusHourlyClamp: Math.abs(P + clamp(0.0000125 - P, -0.0000625, 0.0000625) - F) < 1e-9,
        hip3Params: Math.abs((hip3.multiplier * (P + clamp(hip3.interest - P, -hip3.clamp, hip3.clamp))) / 8 - F) < 1e-9,
      };
    });
    const count = (k) => tests.filter((t) => t[k]).length;
    log('fundingHistory', {
      coin,
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      rows: rows.length,
      first: rows[0],
      last: rows.at(-1),
      gapsMs: hist(gaps),
      msAfterHour: stats(offsets),
      formula: { eighthOfF8: count('eighthOfF8'), premiumPlusHourlyClamp: count('premiumPlusHourlyClamp'), hip3Params: count('hip3Params') },
      fundingValues: Object.entries(hist(rows.map((x) => x.fundingRate))).sort((a, b) => b[1] - a[1]).slice(0, 4),
      ctxNow: byName.get(coin)?.c ?? null,
    });
  }
  log('weight', { total: totalWeight });
}

function bookSummary(r) {
  const j = r.json;
  if (!j || !j.levels) return { status: r.status, body: r.text.slice(0, 200) };
  const [bids, asks] = j.levels;
  const desc = (a) => a.every((l, i) => i === 0 || Number(l.px) < Number(a[i - 1].px));
  const asc = (a) => a.every((l, i) => i === 0 || Number(l.px) > Number(a[i - 1].px));
  return {
    status: r.status,
    ms: r.ms,
    bytes: r.bytes,
    coin: j.coin,
    time: j.time,
    ageMsAtArrival: r.after - j.time,
    keys: Object.keys(j),
    bids: bids.length,
    asks: asks.length,
    bidsDescending: desc(bids),
    asksAscending: asc(asks),
    top: { bid: bids[0], ask: asks[0] },
    levelKeys: Object.keys(bids[0] ?? {}),
  };
}

async function book() {
  const a = await info({ type: 'l2Book', coin: 'BTC' }, { name: 'l2Book-BTC.json' });
  log('l2Book_BTC', bookSummary(a));
  await sleep(200);
  const b = await info({ type: 'l2Book', coin: 'BTC' });
  log('l2Book_BTC_again', { ...bookSummary(b), timeDeltaMs: b.json?.time - a.json?.time, sameBody: a.text === b.text });
  for (const [label, body] of [
    ['nSigFigs5_mantissa2', { type: 'l2Book', coin: 'BTC', nSigFigs: 5, mantissa: 2 }],
    ['nSigFigs3', { type: 'l2Book', coin: 'BTC', nSigFigs: 3 }],
    ['kPEPE', { type: 'l2Book', coin: 'kPEPE' }],
    ['hip3_xyz_XYZ100', { type: 'l2Book', coin: 'xyz:XYZ100' }],
    ['spot_PURR', { type: 'l2Book', coin: 'PURR/USDC' }],
    ['spot_at107', { type: 'l2Book', coin: '@107' }],
    ['unknown', { type: 'l2Book', coin: 'NOPE' }],
    ['delisted_LOOM', { type: 'l2Book', coin: 'LOOM' }],
  ]) {
    await sleep(300);
    log(`l2Book_${label}`, bookSummary(await info(body)));
  }
  log('weight', { total: totalWeight });
}

async function errors() {
  const cases = [
    ['unknown_type', { body: { type: 'nope' } }],
    ['unknown_dex', { body: { type: 'metaAndAssetCtxs', dex: 'nope' } }],
    ['fundingHistory_no_startTime', { body: { type: 'fundingHistory', coin: 'BTC' } }],
    ['fundingHistory_unknown_coin', { body: { type: 'fundingHistory', coin: 'NOPE', startTime: Date.now() - 3_600_000 } }],
    ['bad_json', { body: { type: 'meta' }, raw: '{"type":' }],
    ['get', { body: null, method: 'GET', weight: 20 }],
    ['text_plain', { body: { type: 'exchangeStatus' }, headers: { 'content-type': 'text/plain' } }],
  ];
  for (const [label, c] of cases) {
    const r = await info(c.body, { raw: c.raw, method: c.method, weight: c.weight ?? 20, headers: c.headers });
    log(`error_${label}`, { status: r.status, ms: r.ms, contentType: r.headers.get('content-type'), retryAfter: r.headers.get('retry-after'), body: r.text.slice(0, 200) });
    await sleep(500);
  }
  log('weight', { total: totalWeight });
}

// Hyperps take their oracle from an 8 h EMA of their own minutely mark (hyperps page), so the oracle moves at most once a minute.
// This mode looks for them through the category annotations and through an oracle that holds still while the mark moves.
async function hyperps() {
  const cats = await info({ type: 'perpCategories' }, { name: 'perpCategories.json' });
  const catList = Array.isArray(cats.json) ? cats.json : [];
  log('perpCategories', { status: cats.status, ms: cats.ms, bytes: cats.bytes, entries: catList.length, sample: catList.slice(0, 3), categories: hist(catList.map((e) => (Array.isArray(e) ? e[1] : e?.category))) });
  const ann = await info({ type: 'perpConciseAnnotations' }, { name: 'perpConciseAnnotations.json' });
  const annList = Array.isArray(ann.json) ? ann.json : [];
  const text = (e) => JSON.stringify(e).toLowerCase();
  log('perpConciseAnnotations', { status: ann.status, ms: ann.ms, bytes: ann.bytes, entries: annList.length, sample: annList.slice(0, 2), mentionsHyperpOrPrelaunch: annList.filter((e) => /hyperp|pre-?launch/.test(text(e))).slice(0, 20) });
  const a = await info({ type: 'metaAndAssetCtxs' });
  await sleep(20_000);
  const b = await info({ type: 'metaAndAssetCtxs' });
  const [m, ca] = a.json;
  const cb = b.json[1];
  const still = [];
  let markMoved = 0;
  for (let i = 0; i < m.universe.length; i++) {
    if (m.universe[i].isDelisted) continue;
    if (ca[i].markPx !== cb[i].markPx) {
      markMoved++;
      if (ca[i].oraclePx === cb[i].oraclePx) still.push(`${m.universe[i].name} mark ${ca[i].markPx} to ${cb[i].markPx}, oracle ${ca[i].oraclePx}`);
    }
  }
  log('oracle_still_mark_moved_20s', { markMoved, oracleStill: still.length, assets: still.slice(0, 30) });
  log('weight', { total: totalWeight });
}

const modes = { host, catalog, ccxt: ccxtMode, anchor, dexes, funding, book, errors, hyperps };
const mode = process.argv[2];
if (!modes[mode]) {
  console.error(`usage: rest-probe.mjs <${Object.keys(modes).join('|')}>`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
