// Hyperliquid decentralised-layer probe: builder dexes (HIP-3), their oracles and collateral, ticker collisions, the block clock against arrival, and where the API sits.
// Public, unauthenticated and read-only, calling only POST https://api.hyperliquid.xyz/info and wss://api.hyperliquid.xyz/ws.
// It makes no /exchange call, holds no wallet and signs nothing.
// The IP budget is 1200 weight a minute.
// perpDexs, allPerpMetas, spotMeta, metaAndAssetCtxs, predictedFundings and gossipRootIps weigh 20, and exchangeStatus and l2Book weigh 2.
// Calls are spaced 1.5 s apart, so no mode goes near the budget.
// Run from the repository root: node --max-old-space-size=512 scripts/probes/venues/hyperliquid/dex-probe.mjs [dexes|lag|ccxt|socket]
// The working directory does not matter, because every local path is resolved from this file.
//   dexes   perpDexs, allPerpMetas, spotMeta, predictedFundings, one metaAndAssetCtxs per dex with live assets and one for a retired dex, then name collisions, in about 20 s and 200 weight.
//   lag     DNS, then 30 exchangeStatus calls with an l2Book BTC after every third, then gossipRootIps and reverse DNS of each root peer, in about 60 s and 100 weight.
//   ccxt    CCXT 4.5.68 loadMarkets with default options, and how it names, quotes and ids the builder dex markets, in about 12 info calls and 250 weight in one burst.
//   socket  one socket for 60 s with bbo, trades and l2Book on BTC and on two xyz coins, activeAssetCtx on six coins, allDexsAssetCtxs and an explorerBlock attempt.
//           Then two 6 s sockets add a retired dex coin and an unknown dex coin after a bbo BTC, to see which one the server drops.
// Set PROBE_OUT_DIR to keep the raw replies.
// Recorded in docs/research/2026-09-23-hyperliquid-dex.md.
import { lookup, reverse } from 'node:dns/promises';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

// ccxt and ws come from the TypeScript server's install, whose home moved during 2026-09-23, so each known place is tried.
// The last one is pnpm's hidden hoist directory at the workspace root.
const INSTALLS = ['server/package.json', 'old_ts_server/package.json', 'node_modules/.pnpm/node_modules/probe.json'];
function load(name) {
  for (const base of INSTALLS) {
    try {
      return createRequire(new URL(`../../../../${base}`, import.meta.url))(name);
    } catch {}
  }
  throw new Error(`${name} is not installed in ${INSTALLS.join(', ')}`);
}
const WebSocket = load('ws');

const INFO = 'https://api.hyperliquid.xyz/info';
const WS_URL = 'wss://api.hyperliquid.xyz/ws';
const SPACING_MS = 1_500;
const OUT = process.env.PROBE_OUT_DIR;
const ACTIVE_CTX = ['BTC', 'ETH', 'xyz:XYZ100', 'xyz:GOLD', 'xyz:CXMT', 'para:BTCD']; // one pre-IPO and one para index among them
const PRE_IPO = new Set(['xyz:CXMT', 'xyz:OURA', 'xyz:SHEIN', 'xyz:SKHY', 'xyz:UNITREE']); // docs.trade.xyz pre-IPO specification index, internal oracle only
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
let lastCall = 0;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name.replace(/[^A-Za-z0-9_.-]+/g, '_')), text);
}

async function info(body, name = body.type) {
  const wait = lastCall + SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall = Date.now();
  const sent = Date.now();
  const res = await fetch(INFO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  const arrived = Date.now();
  keep(`${name}.json`, text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  const h = (k) => res.headers.get(k);
  return { status: res.status, ms: arrived - sent, bytes: text.length, json, text, sent, arrived, pop: h('x-amz-cf-pop'), cache: h('x-cache'), server: h('server'), date: h('date'), retryAfter: h('retry-after') };
}

const pct = (xs, p) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const dist = (xs) => ({ n: xs.length, min: pct(xs, 0), p10: pct(xs, 0.1), median: pct(xs, 0.5), p90: pct(xs, 0.9), max: pct(xs, 1) });
const ppm = (a, b) => Math.round((Number(a) / Number(b) - 1) * 1e6);
const bare = (name) => (name.includes(':') ? name.split(':')[1] : name);

// The engine's deny list is read from the source so the probe follows it.
// The TypeScript server has moved twice, so each known home is tried.
const OVERRIDES = ['old_ts_server/src', 'server/ts/src', 'server/src'].map((d) => new URL(`../../../../${d}/engine/cluster/clusterOverrides.ts`, import.meta.url));
function deniedBases() {
  for (const url of OVERRIDES) {
    try {
      return [...readFileSync(url, 'utf8').matchAll(/'([A-Z0-9]+)\|USDT'/g)].map((m) => m[1]);
    } catch {}
  }
  return ['BB', 'ON', 'QNT', 'ONE']; // DENIED_PAIRS on 2026-09-23, used when no source file is found
}

async function dexes() {
  const pd = await info({ type: 'perpDexs' });
  log('perpDexs', { status: pd.status, ms: pd.ms, bytes: pd.bytes, entries: pd.json.length, first: pd.json[0] });
  for (const [i, d] of pd.json.entries()) {
    if (!d) continue;
    const signers = (d.subDeployers ?? []).find(([k]) => k === 'setOracle')?.[1] ?? [];
    const clamps = d.assetToFundingClamp ?? [];
    log('dex', {
      index: i,
      name: d.name,
      fullName: d.fullName,
      deployer: d.deployer,
      oracleUpdater: d.oracleUpdater ?? 'null, so the deployer',
      setOracleSigners: signers.length,
      oiCapAssets: (d.assetToStreamingOiCap ?? []).length,
      fundingMultipliers: (d.assetToFundingMultiplier ?? []).length,
      fundingInterestRates: (d.assetToFundingInterestRate ?? []).length,
      fundingClamps: clamps.length,
      clampValues: [...new Set(clamps.map(([, v]) => v))],
      assetIdBase: 100000 + i * 10000,
      ccxtLoadsByDefault: i < 10, // hyperliquid.js fetchHip3Markets loops i = 1 to limit - 1, limit 10
    });
  }

  const apm = await info({ type: 'allPerpMetas' });
  const sm = await info({ type: 'spotMeta' });
  const tokenName = new Map(sm.json.tokens.map((t) => [t.index, t.name]));
  const quotes = {};
  for (const u of sm.json.universe) {
    const q = tokenName.get(u.tokens[1]);
    quotes[q] = (quotes[q] ?? 0) + 1;
  }
  log('spotMeta', { ms: sm.ms, bytes: sm.bytes, tokens: sm.json.tokens.length, pairs: sm.json.universe.length, pairsByQuote: quotes, uPrefixed: sm.json.tokens.filter((t) => /^U[A-Z]{2,}/.test(t.name)).map((t) => t.name).slice(0, 12) });

  const names = []; // [dexIndex, dexName, universe]
  for (const [i, m] of apm.json.entries()) {
    const dexName = i === 0 ? '' : pd.json[i]?.name;
    const u = m.universe ?? [];
    const live = u.filter((x) => x.isDelisted !== true);
    const modes = {};
    for (const x of live) modes[x.marginMode ?? (x.onlyIsolated ? 'onlyIsolated' : 'cross')] = (modes[x.marginMode ?? (x.onlyIsolated ? 'onlyIsolated' : 'cross')] ?? 0) + 1;
    log('meta', { index: i, dex: dexName || '(main)', collateralToken: m.collateralToken, collateral: tokenName.get(m.collateralToken), universe: u.length, live: live.length, growthMode: live.filter((x) => x.growthMode === 'enabled').length, marginModes: modes, sample: live.slice(0, 8).map((x) => x.name) });
    names.push([i, dexName, u]);
  }

  // One metaAndAssetCtxs per dex with live assets, and one for the first retired dex.
  const retired = names.find(([i, , u]) => i > 0 && u.length > 0 && u.every((x) => x.isDelisted === true));
  const targets = names.filter(([, , u]) => u.some((x) => x.isDelisted !== true));
  if (retired) targets.push(retired);
  const pxByName = new Map(); // coin name to oraclePx, for the collision lines
  for (const [i, dexName] of targets) {
    const r = await info(i === 0 ? { type: 'metaAndAssetCtxs' } : { type: 'metaAndAssetCtxs', dex: dexName }, `metaAndAssetCtxs-${dexName || 'main'}`);
    const [meta, ctxs] = r.json;
    const rows = meta.universe.map((u, j) => ({ ...u, ...ctxs[j] }));
    const live = rows.filter((x) => x.isDelisted !== true);
    for (const x of live) pxByName.set(x.name, x.oraclePx);
    const markOracle = live.filter((x) => Number(x.oraclePx) > 0).map((x) => Math.abs(ppm(x.markPx, x.oraclePx)));
    const midOracle = live.filter((x) => x.midPx && Number(x.oraclePx) > 0).map((x) => ppm(x.midPx, x.oraclePx));
    log('ctxs', {
      dex: dexName || '(main)',
      ms: r.ms,
      bytes: r.bytes,
      live: live.length,
      noMid: live.filter((x) => !x.midPx).length,
      zeroVolume: live.filter((x) => Number(x.dayNtlVlm) === 0).length,
      dayNtlVlmUsd: Math.round(live.reduce((s, x) => s + Number(x.dayNtlVlm), 0)),
      absMarkOverOraclePpm: dist(markOracle),
      midOverOraclePpm: dist(midOracle),
      midBeyond1pct: midOracle.filter((v) => Math.abs(v) > 10_000).length,
      top: [...live].sort((a, b) => Number(b.dayNtlVlm) - Number(a.dayNtlVlm)).slice(0, 5).map((x) => ({ name: x.name, oraclePx: x.oraclePx, markPx: x.markPx, midPx: x.midPx, funding: x.funding, dayNtlVlm: Math.round(Number(x.dayNtlVlm)) })),
    });
    if (i > 0 && live.length === 0) {
      log('retiredCtx', { dex: dexName, sample: rows.slice(0, 2).map((x) => ({ name: x.name, oraclePx: x.oraclePx, markPx: x.markPx, midPx: x.midPx, openInterest: x.openInterest, dayNtlVlm: x.dayNtlVlm })) });
    }
    const preIpo = live.filter((x) => PRE_IPO.has(x.name));
    if (preIpo.length) log('preIpo', { rows: preIpo.map((x) => ({ name: x.name, oraclePx: x.oraclePx, markPx: x.markPx, midPx: x.midPx, markOverOraclePpm: ppm(x.markPx, x.oraclePx), midOverOraclePpm: x.midPx ? ppm(x.midPx, x.oraclePx) : null })) });
  }

  // predictedFundings is Hyperliquid's own map from its coins to the Binance and Bybit perps it compares against.
  const pf = await info({ type: 'predictedFundings' });
  const venuesOf = new Map(pf.json.map(([coin, vs]) => [coin, vs.filter(([, x]) => x).map(([v]) => v)])); // a venue without that perp answers null
  const venueCounts = {};
  for (const vs of venuesOf.values()) for (const v of vs) venueCounts[v] = (venueCounts[v] ?? 0) + 1;
  log('predictedFundings', { ms: pf.ms, coins: venuesOf.size, byVenue: venueCounts, hip3Coins: [...venuesOf.keys()].filter((c) => c.includes(':')).length, kCoins: [...venuesOf.entries()].filter(([c]) => /^k[A-Z]/.test(c)).map(([c, v]) => `${c}:${v.join('+')}`) });

  // Collisions between a builder dex's bare ticker and every other name the engine could meet.
  const mainLive = new Set(names[0][2].filter((x) => x.isDelisted !== true).map((x) => x.name));
  const mainAll = new Set(names[0][2].map((x) => x.name));
  const spotTokens = new Set(sm.json.tokens.map((t) => t.name));
  const denied = deniedBases();
  const byBare = new Map();
  for (const [i, dexName, u] of names.slice(1)) {
    for (const x of u) {
      const b = bare(x.name);
      if (!byBare.has(b)) byBare.set(b, []);
      byBare.get(b).push({ dex: dexName, live: x.isDelisted !== true, i });
    }
  }
  const liveBare = [...byBare.entries()].filter(([, v]) => v.some((e) => e.live)).map(([b]) => b);
  const oracles = (b) => [b, ...byBare.get(b).filter((e) => e.live).map((e) => `${e.dex}:${b}`)].filter((n) => pxByName.has(n)).map((n) => `${n} ${pxByName.get(n)}`).join(' vs ');
  log('collisions', {
    liveBuilderTickers: liveBare.length,
    sameAsMainLive: liveBare.filter((b) => mainLive.has(b)).map((b) => `${oracles(b)} (main coin compared with ${(venuesOf.get(b) ?? []).join('+') || 'none'})`),
    sameAsMainDelisted: liveBare.filter((b) => !mainLive.has(b) && mainAll.has(b)),
    sameAsSpotToken: liveBare.filter((b) => spotTokens.has(b)),
    inDeniedPairs: liveBare.filter((b) => denied.includes(b)).map(oracles),
    deniedPairsRead: denied,
    listedOnTwoLiveDexes: [...byBare.entries()].filter(([, v]) => v.filter((e) => e.live).length > 1).map(([b, v]) => `${b}: ${v.filter((e) => e.live).map((e) => e.dex).join(',')}`),
    listedOnLiveAndRetiredDex: [...byBare.entries()].filter(([, v]) => v.some((e) => e.live) && v.some((e) => !e.live)).length,
  });
}

async function lag() {
  const addrs = await lookup('api.hyperliquid.xyz', { all: true });
  let ptr = null;
  try {
    ptr = await reverse(addrs[0].address);
  } catch (e) {
    ptr = String(e.code);
  }
  log('dns', { addrs: addrs.map((a) => a.address), firstPtr: ptr });

  const age = [];
  const rtt = [];
  const ageBook = [];
  let pops = new Set();
  let first = null;
  for (let k = 0; k < 30; k++) {
    const r = await info({ type: 'exchangeStatus' }, 'exchangeStatus');
    pops.add(r.pop);
    if (k === 0) first = { status: r.status, body: r.text, server: r.server, cache: r.cache, date: r.date };
    rtt.push(r.ms);
    // Arrival minus half the round trip, minus the block time the server reports, is how old its state was when it answered.
    if (k > 0) age.push(Math.round(r.arrived - r.ms / 2 - r.json.time));
    if (k % 3 === 2) {
      const b = await info({ type: 'l2Book', coin: 'BTC' }, 'l2Book');
      ageBook.push(Math.round(b.arrived - b.ms / 2 - b.json.time));
    }
  }
  log('lag', { first, pops: [...pops], rttMs: dist(rtt.slice(1)), stateAgeMs: dist(age), l2BookAgeMs: dist(ageBook), note: 'cold first call left out of rtt and age' });

  const g = await info({ type: 'gossipRootIps' });
  const ips = Array.isArray(g.json) ? g.json : [];
  const suffix = {};
  for (const ip of ips) {
    let host = 'no PTR';
    try {
      host = (await reverse(ip))[0] ?? 'no PTR';
    } catch {}
    const tail = host.match(/(ap-[a-z]+-\d|eu-[a-z]+-\d|us-[a-z]+-\d)/)?.[1] ?? host.split('.').slice(-2).join('.');
    suffix[tail] = (suffix[tail] ?? 0) + 1;
  }
  log('gossipRootIps', { status: g.status, count: ips.length, sample: ips.slice(0, 4), ptrRegions: suffix });
}

async function socket() {
  const apm = await info({ type: 'allPerpMetas' });
  const pd = await info({ type: 'perpDexs' });
  const dexNames = apm.json.map((_, i) => (i === 0 ? '' : pd.json[i]?.name));
  const universes = new Map(apm.json.map((m, i) => [dexNames[i], m.universe.map((u) => u.name)]));
  const xyz = ['xyz:XYZ100', 'xyz:GOLD'];

  const opened = Date.now();
  const ws = new WebSocket(WS_URL, { perMessageDeflate: false });
  const frames = {};
  const lags = {};
  const blockTimes = new Set();
  const bookPush = [];
  const ctxFrames = [];
  const assetCtx = new Map(); // coin to { frames, oracle, mark, oracleAt[], markAt[] }
  let tradesFrames = 0;
  const oracleSeen = new Map(); // `${dex}|${coin}` to [lastOracle, changeTimes[]]
  const other = [];
  ws.on('upgrade', (res) => log('upgrade', { ms: Date.now() - opened, server: res.headers.server, via: res.headers.via, pop: res.headers['x-amz-cf-pop'], extensions: res.headers['sec-websocket-extensions'] ?? null }));
  ws.on('open', () => {
    const subs = [
      { type: 'bbo', coin: 'BTC' },
      { type: 'bbo', coin: 'ETH' },
      { type: 'trades', coin: 'BTC' },
      { type: 'l2Book', coin: 'BTC' },
      ...xyz.map((coin) => ({ type: 'bbo', coin })),
      { type: 'l2Book', coin: xyz[1] },
      { type: 'allDexsAssetCtxs' },
      ...ACTIVE_CTX.map((coin) => ({ type: 'activeAssetCtx', coin })),
      { type: 'explorerBlock' },
    ];
    for (const s of subs) ws.send(JSON.stringify({ method: 'subscribe', subscription: s }));
  });
  const ping = setInterval(() => ws.send(JSON.stringify({ method: 'ping' })), 30_000);
  ws.on('message', (buf) => {
    const at = Date.now();
    const text = buf.toString();
    let m;
    try {
      m = JSON.parse(text);
    } catch {
      other.push(text.slice(0, 200));
      return;
    }
    const ch = m.channel;
    const key = ch === 'bbo' || ch === 'l2Book' ? `${ch}:${m.data?.coin}` : (ch ?? 'noChannel');
    frames[key] = (frames[key] ?? 0) + 1;
    if (ch === 'bbo' || ch === 'l2Book') {
      const t = m.data.time;
      blockTimes.add(t);
      (lags[key] ??= []).push(at - t);
      if (ch === 'l2Book' && m.data.coin === 'BTC') bookPush.push(t);
    } else if (ch === 'activeAssetCtx') {
      const a = assetCtx.get(m.data.coin) ?? { frames: 0, oracle: null, mark: null, oracleAt: [], markAt: [] };
      a.frames++;
      if (a.oracle !== null && a.oracle !== m.data.ctx.oraclePx) a.oracleAt.push(at);
      if (a.mark !== null && a.mark !== m.data.ctx.markPx) a.markAt.push(at);
      a.oracle = m.data.ctx.oraclePx;
      a.mark = m.data.ctx.markPx;
      assetCtx.set(m.data.coin, a);
    } else if (ch === 'trades') {
      if (tradesFrames++ === 0) return; // the first frame replays recent trades, so its times are old
      for (const tr of m.data) {
        blockTimes.add(tr.time);
        (lags.trades ??= []).push(at - tr.time);
      }
    } else if (ch === 'allDexsAssetCtxs') {
      ctxFrames.push({ at, bytes: text.length, dexes: m.data.ctxs.length });
      for (const [dex, ctxs] of m.data.ctxs) {
        const u = universes.get(dex) ?? [];
        ctxs.forEach((c, j) => {
          const k = `${dex}|${u[j]}`;
          const prev = oracleSeen.get(k);
          if (!prev) oracleSeen.set(k, [c.oraclePx, []]);
          else if (prev[0] !== c.oraclePx) {
            prev[0] = c.oraclePx;
            prev[1].push(at);
          }
        });
      }
    } else if (other.length < 24) {
      other.push(text.slice(0, 240)); // acks, pongs, errors and any channel not handled above
    }
  });
  let closedBy = 'server';
  ws.on('close', (code) => log('close', { code, closedBy, afterMs: Date.now() - opened }));
  ws.on('error', (e) => log('error', { message: e.message }));
  await sleep(60_000);
  clearInterval(ping);
  closedBy = 'probe';
  ws.close();
  await sleep(500);

  const sortedTimes = [...blockTimes].sort((a, b) => a - b);
  const gaps = sortedTimes.slice(1).map((t, i) => t - sortedTimes[i]).filter((g) => g > 0);
  const lagDists = Object.fromEntries(Object.entries(lags).map(([k, v]) => [k, dist(v)]));
  const bookGaps = bookPush.slice(1).map((t, i) => t - bookPush[i]);
  const perDex = {};
  for (const [k, [, changes]] of oracleSeen) {
    const dex = k.split('|')[0] || '(main)';
    const d = (perDex[dex] ??= { assets: 0, changed: 0, gaps: [] });
    d.assets++;
    if (changes.length) d.changed++;
    for (let i = 1; i < changes.length; i++) d.gaps.push(changes[i] - changes[i - 1]);
  }
  const ctxGaps = ctxFrames.slice(1).map((f, i) => f.at - ctxFrames[i].at);
  log('socket', {
    frames,
    lagMs: lagDists,
    distinctBlockTimes: sortedTimes.length,
    blockTimeGapMs: dist(gaps),
    l2BookBtcPushGapMs: dist(bookGaps),
    allDexsAssetCtxs: { frames: ctxFrames.length, gapMs: dist(ctxGaps), bytes: dist(ctxFrames.map((f) => f.bytes)), dexes: ctxFrames[0]?.dexes },
    activeAssetCtx: Object.fromEntries([...assetCtx].map(([coin, a]) => [coin, { frames: a.frames, oracleChanges: a.oracleAt.length, oracleGapMs: dist(a.oracleAt.slice(1).map((t, i) => t - a.oracleAt[i])), markChanges: a.markAt.length, markGapMs: dist(a.markAt.slice(1).map((t, i) => t - a.markAt[i])) }])),
    oracleChangeGapMs: Object.fromEntries(Object.entries(perDex).map(([k, v]) => [k, { assets: v.assets, changed: v.changed, gap: dist(v.gaps) }])),
  });
  log('socketOther', { frames: other.slice(0, 16) });

  for (const coin of ['flx:TSLA', 'zzz:BTC']) await badCoin(coin);
}

// A bbo BTC first, then the coin under test 1.5 s later, and the socket is watched until 6 s.
function badCoin(coin) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let sentAt = null;
    let bboAfter = 0;
    const frames = [];
    const ws = new WebSocket(WS_URL, { perMessageDeflate: false });
    ws.on('open', () => {
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'bbo', coin: 'BTC' } }));
      setTimeout(() => {
        sentAt = Date.now() - t0;
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'bbo', coin } }));
      }, 1_500);
    });
    ws.on('message', (b) => {
      const text = b.toString();
      if (sentAt !== null && text.includes('"coin":"BTC"') && text.includes('"bbo"')) bboAfter++;
      if (!text.includes('"coin":"BTC"')) frames.push(`${Date.now() - t0} ms ${text.slice(0, 200)}`);
    });
    const timer = setTimeout(() => ws.close(), 6_000);
    ws.on('close', (code) => {
      clearTimeout(timer);
      log('badCoin', { coin, subscribedAtMs: sentAt, closedAtMs: Date.now() - t0, code, btcBboAfterSubscribe: bboAfter, frames });
      resolve();
    });
  });
}

async function ccxtMarkets() {
  const ccxt = load('ccxt');
  const ex = new ccxt.hyperliquid();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.type === 'swap');
  const hip3 = swaps.filter((m) => m.info?.hip3 === true);
  const byDex = {};
  for (const m of hip3) {
    const d = (byDex[m.info.dex] ??= { markets: 0, active: 0, quotes: {} });
    d.markets++;
    if (m.active !== false) d.active++;
    d.quotes[m.quote] = (d.quotes[m.quote] ?? 0) + 1;
  }
  const pick = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, baseName: m.baseName, active: m.active, contractSize: m.contractSize, taker: m.taker });
  const activeSwaps = swaps.filter((m) => m.active !== false);
  const pairCount = {};
  for (const m of activeSwaps) pairCount[`${m.base}|${m.quote}`] = (pairCount[`${m.base}|${m.quote}`] ?? 0) + 1;
  log('ccxt', {
    version: ccxt.version,
    ms: Date.now() - t0,
    swaps: swaps.length,
    activeSwaps: activeSwaps.length,
    mainActive: activeSwaps.filter((m) => m.info?.hip3 !== true).length,
    hip3ByDex: byDex,
    ioLoaded: hip3.some((m) => m.info.dex === 'io'),
    samples: ['BTC/USDC:USDC', 'KPEPE/USDC:USDC', 'STX/USDC:USDC'].filter((s) => markets[s]).map((s) => pick(markets[s])),
    hip3Samples: hip3.filter((m) => ['xyz:BB', 'xyz:TSLA', 'para:STX', 'flx:TSLA'].includes(m.baseName)).map(pick),
    duplicatePairs: Object.entries(pairCount).filter(([, n]) => n > 1).map(([k]) => k),
  });
}

const mode = process.argv[2] ?? 'dexes';
const run = { dexes, lag, socket, ccxt: ccxtMarkets }[mode];
if (!run) {
  console.error(`unknown mode ${mode}, use dexes, lag, ccxt or socket`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await run();
