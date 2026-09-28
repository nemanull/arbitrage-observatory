// Hyperliquid fees, access and CCXT probe: the public fee schedule through userFees, funding as a cost across every perp dex, the CCXT catalog and its fee constant, and the coin names the info call and the socket use.
// Public, unauthenticated and read-only: POST https://api.hyperliquid.xyz/info and one short wss://api.hyperliquid.xyz/ws socket, never /exchange, no wallet, no signature.
// userFees takes any address, so it reads the zero address and the assistance fund system address that the fees page names.
// The published IP budget is 1200 weight per minute, userFees, metaAndAssetCtxs, allPerpMetas and perpDexs weigh 20 and allMids weighs 2.
// One run spends 122 weight on seven raw calls spaced 3 s apart, and CCXT's loadMarkets spends about 260 more in thirteen calls, so a run stays near a third of one minute's budget.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hyperliquid/fees-probe.mjs
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/hyperliquid/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');
const WebSocket = require('ws');

const INFO = 'https://api.hyperliquid.xyz/info';
const WS = 'wss://api.hyperliquid.xyz/ws';
const ZERO = '0x0000000000000000000000000000000000000000';
const ASSISTANCE_FUND = '0xfefefefefefefefefefefefefefefefefefefefe';
const OUT = process.env.PROBE_OUT_DIR;
const GAP_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (values) => values.reduce((m, v) => ((m[v] = (m[v] ?? 0) + 1), m), {});

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function info(body, name) {
  const t0 = performance.now();
  const res = await fetch(INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  keep(`${name}.json`, text);
  log('http', {
    name,
    status: res.status,
    ms,
    bytes: text.length,
    pop: res.headers.get('x-amz-cf-pop'),
    cache: res.headers.get('x-cache'),
    server: res.headers.get('server'),
  });
  await sleep(GAP_MS);
  return res.ok ? JSON.parse(text) : null;
}

function userFees(tag, r) {
  if (!r) return;
  const s = r.feeSchedule;
  log(tag, {
    base: { cross: s.cross, add: s.add, spotCross: s.spotCross, spotAdd: s.spotAdd },
    vip: s.tiers.vip,
    mm: s.tiers.mm,
    referralDiscount: s.referralDiscount,
    stakingDiscountTiers: s.stakingDiscountTiers,
    userCrossRate: r.userCrossRate,
    userAddRate: r.userAddRate,
    userSpotCrossRate: r.userSpotCrossRate,
    userSpotAddRate: r.userSpotAddRate,
    activeReferralDiscount: r.activeReferralDiscount,
    activeStakingDiscount: r.activeStakingDiscount,
    otherKeys: Object.keys(r).filter(
      (k) => !['feeSchedule', 'dailyUserVlm', 'userCrossRate', 'userAddRate', 'userSpotCrossRate', 'userSpotAddRate', 'activeReferralDiscount', 'activeStakingDiscount'].includes(k),
    ),
    scheduleKeys: Object.keys(s),
    dailyUserVlmDays: r.dailyUserVlm?.length,
  });
}

// Hourly funding from each asset context, against the documented 4 percent per hour cap and the 0.00125 percent hourly interest term.
function funding(tag, reply) {
  const [meta, ctxs] = reply;
  const live = meta.universe.map((u, i) => ({ u, c: ctxs[i] })).filter(({ u }) => u.isDelisted !== true);
  const rates = live.map(({ c }) => Number(c.funding)).filter(Number.isFinite);
  const abs = rates.map(Math.abs);
  const top = live
    .map(({ u, c }) => [u.name, c.funding])
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 3);
  log(tag, {
    metaKeys: Object.keys(meta),
    collateralToken: meta.collateralToken,
    universe: meta.universe.length,
    delisted: meta.universe.length - live.length,
    universeKeys: Object.keys(count(meta.universe.flatMap((u) => Object.keys(u)))),
    ctxKeys: Object.keys(ctxs[0] ?? {}),
    growthMode: count(meta.universe.map((u) => String(u.growthMode))),
    marginMode: count(meta.universe.map((u) => String(u.marginMode))),
    live: live.length,
    atInterestOnly: rates.filter((f) => f === 0.0000125).length,
    positive: rates.filter((f) => f > 0).length,
    negative: rates.filter((f) => f < 0).length,
    maxAbs: Math.max(...abs),
    atOrAboveCap: abs.filter((f) => f >= 0.04).length,
    top,
    kPrefixed: live.map(({ u }) => u.name).filter((n) => /^k[A-Z]/.test(n)),
  });
}

// The base-tier taker for one asset by the fees page formula, with no staking, referral or aligned-collateral discount.
// A validator-operated asset has no deployerFeeScale and pays the plain 450 ppm.
function hip3TakerPpm(u) {
  if (u.deployerFeeScale === undefined) return 450;
  const scale = Number(u.deployerFeeScale);
  const hip3 = scale < 1 ? scale + 1 : scale * 2;
  const growth = u.growthMode === 'enabled' ? 0.1 : 1;
  return Math.round(450 * hip3 * growth * 1000) / 1000;
}

async function coinNamesOnSocket(coins) {
  return new Promise((resolve) => {
    const seen = {};
    const t0 = performance.now();
    const ws = new WebSocket(WS, { perMessageDeflate: false });
    const done = () => {
      ws.terminate();
      resolve(seen);
    };
    const timer = setTimeout(done, 6000);
    ws.on('open', () => {
      log('ws_open', { ms: Math.round(performance.now() - t0) });
      for (const coin of coins) {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin } }));
      }
    });
    ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.channel === 'l2Book' && !(msg.data.coin in seen)) {
        seen[msg.data.coin] = { levels: msg.data.levels.map((side) => side.length), time: msg.data.time };
        if (Object.keys(seen).length === coins.length) {
          clearTimeout(timer);
          done();
        }
      } else if (msg.channel === 'error') {
        log('ws_error', { data: msg.data });
      }
    });
    ws.on('error', (e) => log('ws_fail', { error: e.message }));
  });
}

async function main() {
  log('env', { ccxt: ccxt.version, node: process.version, at: new Date().toISOString() });
  const addrs = await dns.resolve4('api.hyperliquid.xyz').catch((e) => [String(e.code)]);
  log('dns', { host: 'api.hyperliquid.xyz', a: addrs });

  userFees('userFees_zero', await info({ type: 'userFees', user: ZERO }, 'userFees-zero'));
  userFees('userFees_assistance_fund', await info({ type: 'userFees', user: ASSISTANCE_FUND }, 'userFees-af'));

  const dexs = await info({ type: 'perpDexs' }, 'perpDexs');
  const dexNames = dexs.slice(1).map((d) => d.name);
  log('perpDexs', {
    first: dexs[0],
    builderDexes: dexNames.length,
    names: dexNames,
    keys: Object.keys(count(dexs.slice(1).flatMap((d) => Object.keys(d)))),
    fundingInterestRates: Object.fromEntries(dexs.slice(1).map((d) => [d.name, d.assetToFundingInterestRate.slice(0, 2)])),
    fundingClamps: Object.fromEntries(dexs.slice(1).filter((d) => d.assetToFundingClamp.length).map((d) => [d.name, d.assetToFundingClamp])),
  });

  const coreCtx = await info({ type: 'metaAndAssetCtxs' }, 'metaAndAssetCtxs-main');
  funding('funding_main', coreCtx);
  funding('funding_xyz', await info({ type: 'metaAndAssetCtxs', dex: 'xyz' }, 'metaAndAssetCtxs-xyz'));

  // Every dex's universe in one call, index 0 being the validator-operated dex, for the deployer fee scale behind each HIP-3 taker.
  const metas = await info({ type: 'allPerpMetas' }, 'allPerpMetas');
  for (const [i, meta] of metas.entries()) {
    const live = meta.universe.filter((u) => u.isDelisted !== true);
    log('fee_scale', {
      dex: i === 0 ? '' : dexNames[i - 1],
      prefix: meta.universe[0]?.name.split(':')[0],
      collateralToken: meta.collateralToken,
      listed: meta.universe.length,
      live: live.length,
      deployerFeeScale: count(live.map((u) => String(u.deployerFeeScale))),
      growthMode: count(live.map((u) => String(u.growthMode))),
      takerPpm: count(live.map((u) => hip3TakerPpm(u))),
    });
  }

  const mids = await info({ type: 'allMids' }, 'allMids');
  const midKeys = Object.keys(mids);
  log('allMids', {
    keys: midKeys.length,
    spotStyle: midKeys.filter((k) => k.startsWith('@')).length,
    sample: midKeys.filter((k) => ['BTC', 'ETH', 'kPEPE', 'PURR/USDC', 'HYPE'].includes(k)),
  });

  const ex = new ccxt.hyperliquid();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const swaps = Object.values(markets).filter((m) => m.type === 'swap' && m.swap === true);
  const active = swaps.filter((m) => m.active !== false);
  const hip3 = active.filter((m) => m.info?.hip3 === true);
  const core = active.filter((m) => m.info?.hip3 !== true);
  log('ccxt_markets', {
    ms: Math.round(performance.now() - t0),
    swaps: swaps.length,
    active: active.length,
    core: core.length,
    hip3: hip3.length,
    hip3ByDex: count(hip3.map((m) => m.info.dex)),
    dexesLoaded: Object.keys(count(hip3.map((m) => m.info.dex))).length,
    dexesListed: dexNames.length,
    dexesMissing: dexNames.filter((d) => !hip3.some((m) => m.info.dex === d)),
    taker: count(active.map((m) => String(m.taker))),
    maker: count(active.map((m) => String(m.maker))),
    contractSize: count(active.map((m) => String(m.contractSize))),
    linear: count(active.map((m) => String(m.linear))),
    quote: count(active.map((m) => `${m.info?.dex ?? 'core'}:${m.quote}`)),
    exchangeFees: ex.fees.swap,
  });
  // Inactive markets too, to tell a dex CCXT never loaded from a dex whose markets are all delisted.
  log('ccxt_dexes', {
    limit: ex.options.fetchMarkets?.hip3,
    swapsByDex: count(swaps.map((m) => `${m.info?.dex ?? 'core'}:${m.active === false ? 'inactive' : 'active'}`)),
    quoteAll: count(swaps.filter((m) => m.info?.hip3).map((m) => `${m.info.dex}:${m.quote}`)),
    collateralNames: Object.fromEntries(
      ['0', '235', '268', '360'].map((id) => [id, ex.options.cachedCurrenciesById?.[id]]),
    ),
  });
  const pick = (m) => ({ id: m.id, symbol: m.symbol, base: m.base, baseName: m.baseName, infoName: m.info.name, taker: m.taker });
  const kCoin = core.find((m) => /^k[A-Z]/.test(m.info.name));
  const hipFirst = hip3[0];
  log('ccxt_ids', {
    btc: pick(markets['BTC/USDC:USDC']),
    k: kCoin && pick(kCoin),
    hip3: hipFirst && pick(hipFirst),
    idEqualsInfoName: active.filter((m) => m.id === m.info.name).length,
    idNumeric: active.filter((m) => /^\d+$/.test(m.id)).length,
  });

  const coins = ['BTC', kCoin?.info.name, hipFirst?.info.name].filter(Boolean);
  log('ws_coins', { asked: coins, seen: await coinNamesOnSocket(coins) });
}

main().catch((e) => {
  log('fatal', { error: String(e?.stack ?? e) });
  process.exitCode = 1;
});
