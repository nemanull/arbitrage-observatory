// idax futures REST probe: host and latency, catalog, anchor calls and how often they change, REST book, errors and clock offset.
// idax runs on a ChainUP white-label backend, so the public futures API is the ChainUP OpenAPI on futuresopenapi.idax.exchange.
// Public, unauthenticated, read-only. At most a few requests per second, far inside ChainUP's documented 12,000 weight per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/idax/rest-probe.mjs [host|catalog|anchor|book|errors]
//   host     DNS, cold and warm request time, clock offset, and what the idax hosts return. About 15 s.
//   catalog  /fapi/v1/contracts by status, type, margin coin and multiplier, pairs listed twice, the spot list, and CCXT ids. About 10 s.
//   anchor   one /fapi/v1/index round over every trading contract, one read of Gate's public USDT perpetual tickers as an outside
//            reference, then 60 s of 1 s polls on four contracts. About 100 s.
//   book     REST depth at several limits, level order, and repeat reads. About 10 s.
//   errors   unknown contracts, missing parameters and response headers. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/idax/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://futuresopenapi.idax.exchange';
const SAPI = 'https://openapi.idax.exchange';
const WEB = 'https://www.idax.exchange';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const count = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' ');
const q = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? { n: s.length, min: s[0], median: s[s.length >> 1], max: s[s.length - 1] } : null; };
const DEV = (a, b) => (b ? Math.round(((a - b) / b) * 1e6) : null); // ppm

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  const body = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try { json = JSON.parse(body); } catch { json = undefined; }
  return { status: res.status, ms, bytes: body.length, body, json, headers: res.headers };
}

async function host() {
  for (const h of ['futuresopenapi.idax.exchange', 'openapi.idax.exchange', 'futuresws.idax.exchange', 'ws.idax.exchange', 'www.idax.exchange']) {
    try {
      const a = await lookup(h, { all: true });
      log('dns', { host: h, addrs: a.map((x) => x.address) });
    } catch (e) {
      log('dns', { host: h, error: e.code });
    }
  }
  const times = [];
  for (let i = 0; i < 6; i++) {
    const t0 = Date.now();
    const r = await get(`${FAPI}/fapi/v1/time`);
    const t1 = Date.now();
    times.push(r.ms);
    if (i === 5) log('time', { status: r.status, body: r.body, offsetMs: r.json.serverTime - Math.round((t0 + t1) / 2), rttMs: t1 - t0 });
    await sleep(300);
  }
  log('latency', { url: '/fapi/v1/time', firstMs: times[0], warmMs: times.slice(1) });
  const h = (await get(`${FAPI}/fapi/v1/ping`)).headers;
  log('headers', { server: h.get('server'), via: h.get('via'), cfRay: h.get('cf-ray'), xCache: h.get('x-cache') });
  for (const u of [`${WEB}/`, `${WEB}/en_US`, `${FAPI}/fapi/v1/ping`, `${SAPI}/sapi/v1/ping`, `${FAPI}/cmc/specifications`, `${SAPI}/sapi/v1/time`]) {
    const r = await get(u);
    log('access', { url: u, status: r.status, ms: r.ms, bytes: r.bytes, cfRay: r.headers.get('cf-ray'), head: r.body.slice(0, 90).replace(/\s+/g, ' ') });
  }
}

async function catalog() {
  const oa = await get(`${FAPI}/fapi/v1/contracts`);
  keep('contracts.json', oa.body);
  const rows = oa.json;
  log('contracts', { status: oa.status, ms: oa.ms, bytes: oa.bytes, n: rows.length, status_: count(rows, (r) => r.status), type: count(rows, (r) => r.type), side: count(rows, (r) => r.side), marginCoin: count(rows, (r) => r.marginCoin), quote: count(rows, (r) => r.symbol.split('-').at(-1)) });
  const live = rows.filter((r) => r.status === 1);
  log('trading', { n: live.length, type: count(live, (r) => r.type), marginCoin: count(live, (r) => r.marginCoin), openTaker: count(live, (r) => r.openTakerFee), closeTaker: count(live, (r) => r.closeTakerFee), openMaker: count(live, (r) => r.openMakerFee), closeMaker: count(live, (r) => r.closeMakerFee), maxLever: count(live, (r) => r.maxLever) });
  log('non_E', { rows: rows.filter((r) => r.type !== 'E').map((r) => ({ s: r.symbol, type: r.type, marginCoin: r.marginCoin, status: r.status, m: r.multiplier, coin: r.multiplierCoin })) });
  log('multiplier', { byMultiplier: count(live, (r) => Number(r.multiplier)), sample: rows.filter((r) => ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-NVDA-USDT', 'E-XAU-USDT'].includes(r.symbol)).map((r) => ({ s: r.symbol, m: Number(r.multiplier), coin: r.multiplierCoin, minVol: r.minOrderVolume, pp: r.pricePrecision, status: r.status })) });
  const bases = live.map((r) => r.symbol.split('-')[1]);
  log('pairs_twice', { dup: bases.filter((b, i) => bases.indexOf(b) !== i) });
  log('halted', { names: rows.filter((r) => r.status !== 1).map((r) => r.symbol) });
  const spot = await get(`${SAPI}/sapi/v1/symbols`);
  log('spot_symbols', { status: spot.status, ms: spot.ms, n: spot.json?.symbols?.length, quote: count(spot.json?.symbols ?? [], (s) => s.quoteAsset) });
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((e) => /idax|chainup/i.test(e)) });
}

async function anchor() {
  const contracts = (await get(`${FAPI}/fapi/v1/contracts`)).json.filter((r) => r.status === 1).map((r) => r.symbol);
  const t0 = performance.now();
  const rows = [];
  for (let i = 0; i < contracts.length; i += 3) {
    const part = await Promise.all(contracts.slice(i, i + 3).map(async (c) => ({ c, r: await get(`${FAPI}/fapi/v1/index?contractName=${c}`), t: await get(`${FAPI}/fapi/v1/ticker?contractName=${c}`) })));
    rows.push(...part);
    await sleep(150);
  }
  const roundMs = Math.round(performance.now() - t0);
  log('index_round', { n: rows.length, roundMs, statuses: [...new Set(rows.map(({ r }) => r.status))], fieldSets: [...new Set(rows.map(({ r }) => Object.keys(r.json ?? {}).join(',')))], ms: q(rows.map(({ r }) => r.ms)), tickerFields: [...new Set(rows.map(({ t }) => Object.keys(t.json ?? {}).join(',')))] });
  keep('index_round.json', JSON.stringify(rows.map(({ c, r, t }) => ({ c, ...r.json, last: t.json?.last }))));
  const offs = rows.map(({ c, r, t }) => ({ c, index: r.json?.indexPrice, tag: r.json?.tagPrice, last: Number(t.json?.last), cur: r.json?.currentFundRate, next: r.json?.nextFundRate, idxVsLastPpm: DEV(r.json?.indexPrice, Number(t.json?.last)), tagVsIdxPpm: DEV(r.json?.tagPrice, r.json?.indexPrice) }));
  log('funding_values', { currentFundRate: q(offs.map((o) => o.cur).filter((x) => x !== undefined)), nextFundRate: q(offs.map((o) => o.next).filter((x) => x !== undefined)), nextDistinct: new Set(offs.map((o) => o.next)).size, zeroIndex: offs.filter((o) => !o.index).map((o) => o.c) });
  log('tag_vs_index', { absPpm: q(offs.filter((o) => o.tagVsIdxPpm !== null).map((o) => Math.abs(o.tagVsIdxPpm))), worst: offs.filter((o) => o.tagVsIdxPpm !== null).sort((a, b) => Math.abs(b.tagVsIdxPpm) - Math.abs(a.tagVsIdxPpm)).slice(0, 6).map((o) => `${o.c}:${o.tagVsIdxPpm}`) });
  log('index_vs_last', { absPpm: q(offs.filter((o) => o.idxVsLastPpm !== null).map((o) => Math.abs(o.idxVsLastPpm))), over2pct: offs.filter((o) => Math.abs(o.idxVsLastPpm ?? 0) > 20_000).map((o) => `${o.c} idx=${o.index} last=${o.last} ${o.idxVsLastPpm}ppm`).slice(0, 15) });

  // An outside reference: Gate's public USDT perpetual index, one bulk read, to tell a stale idax index from a live one.
  const gate = await get('https://api.gateio.ws/api/v4/futures/usdt/tickers');
  const gateIdx = new Map((gate.json ?? []).map((t) => [t.contract, Number(t.index_price)]));
  const ref = offs.map((o) => ({ ...o, gate: gateIdx.get(o.c.slice(2).replace('-', '_')) })).filter((o) => o.gate).map((o) => ({ ...o, idxVsGatePpm: DEV(o.index, o.gate) }));
  log('index_vs_gate', { gateStatus: gate.status, withGate: ref.length, absPpm: q(ref.map((o) => Math.abs(o.idxVsGatePpm))), over2pct: ref.filter((o) => Math.abs(o.idxVsGatePpm) > 20_000).map((o) => `${o.c}:${o.idxVsGatePpm}`), watch: ref.filter((o) => ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-DOGE-USDT'].includes(o.c)).map((o) => `${o.c} idx=${o.index} gate=${o.gate} ${o.idxVsGatePpm}ppm`) });

  const watch = ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-DOGE-USDT'];
  const hist = Object.fromEntries(watch.map((c) => [c, { index: new Set(), tag: new Set(), cur: new Set(), next: new Set(), ms: [] }]));
  const start = Date.now();
  while (Date.now() - start < 60_000) {
    const tt = Date.now();
    const got = await Promise.all(watch.map((c) => get(`${FAPI}/fapi/v1/index?contractName=${c}`).then((r) => ({ c, r }))));
    for (const { c, r } of got) {
      const h = hist[c];
      h.index.add(r.json?.indexPrice); h.tag.add(r.json?.tagPrice); h.cur.add(r.json?.currentFundRate); h.next.add(r.json?.nextFundRate); h.ms.push(r.ms);
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tt)));
  }
  for (const c of watch) {
    const h = hist[c];
    log('poll_1s', { c, polls: h.ms.length, distinctIndex: h.index.size, distinctTag: h.tag.size, distinctCur: h.cur.size, distinctNext: h.next.size, ms: q(h.ms), curValues: [...h.cur].slice(0, 4) });
  }
}

async function book() {
  for (const limit of [5, 20, 100, 200]) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const b = r.json;
    if (!b?.bids) { log('depth', { limit, status: r.status, body: r.body.slice(0, 160) }); continue; }
    const desc = b.bids.every((l, i) => i === 0 || l[0] < b.bids[i - 1][0]);
    const asc = b.asks.every((l, i) => i === 0 || l[0] > b.asks[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bids.length, asks: b.asks.length, bidsDescending: desc, asksAscending: asc, time: b.time, numberTypes: typeof b.bids[0]?.[0] + '/' + typeof b.bids[0]?.[1], top: [b.bids[0], b.asks[0]] });
  }
  const r0 = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT`);
  log('depth_default', { bids: r0.json?.bids?.length, asks: r0.json?.asks?.length });
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-ETH-USDT&limit=5`);
    times.push({ at: Date.now() % 100000, time: r.json?.time % 100000, bid: r.json?.bids?.[0]?.join('@') });
    await sleep(250);
  }
  log('depth_repeat', { reads: times });
  for (const c of ['E-BANK-USDT', 'E-NVDA-USDT', 'E-KLAY-USDT', 'S-BTC-USDT']) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=${c}&limit=100`);
    log('depth_other', { c, status: r.status, bids: r.json?.bids?.length, asks: r.json?.asks?.length, spreadPpm: r.json?.bids?.length && r.json?.asks?.length ? DEV(r.json.asks[0][0], r.json.bids[0][0]) : null, body: r.json?.bids ? undefined : r.body.slice(0, 120) });
  }
  const t = await get(`${FAPI}/fapi/v1/ticker?contractName=E-BTC-USDT`);
  log('ticker', { status: t.status, body: t.body });
}

async function errors() {
  const cases = [
    `${FAPI}/fapi/v1/index?contractName=E-NOPE-USDT`,
    `${FAPI}/fapi/v1/index`,
    `${FAPI}/fapi/v1/depth?contractName=E-NOPE-USDT`,
    `${FAPI}/fapi/v1/depth?contractName=e-btc-usdt&limit=5`,
    `${FAPI}/fapi/v1/depth?contractName=BTC-USDT&limit=5`,
    `${FAPI}/fapi/v1/ticker?contractName=E-NOPE-USDT`,
    `${FAPI}/fapi/v1/ticker`,
    `${FAPI}/fapi/v1/nope`,
  ];
  for (const u of cases) {
    const r = await get(u);
    log('error_case', { url: u.replace(FAPI, ''), status: r.status, ms: r.ms, body: r.body.slice(0, 160) });
  }
  const r = await get(`${FAPI}/fapi/v1/index?contractName=E-BTC-USDT`);
  const hs = {};
  r.headers.forEach((v, k) => { hs[k] = v.slice(0, 80); });
  log('headers', hs);
}

const mode = process.argv[2] ?? 'host';
const modes = { host, catalog, anchor, book, errors };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(2);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
