// OmniX (formerly CoinChief) futures REST probe: host and latency, catalog, anchor calls and how often they change, REST book, errors and clock offset.
// OmniX runs on a ChainUP white-label backend, so the public futures API lives on the CoinChief hosts that the OmniX site's own config names.
// Public, unauthenticated, read-only. At most a few requests per second, far inside the documented 12,000 weight per minute per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/omnix/rest-probe.mjs [host|catalog|anchor|book|errors]
//   host     DNS, cold and warm request time, clock offset, and what the OmniX and CoinChief hosts return. About 15 s.
//   catalog  /fapi/v1/contracts, the web front's contract list and the CMC feed, compared. About 10 s.
//   anchor   one /fapi/v1/index round over every contract, one read of Gate's public USDT perpetual tickers as an outside index reference,
//            then 60 s of 1 s polls on four contracts and the CMC bulk feed every 5 s. About 90 s.
//   book     REST depth at several limits, level order, and repeat reads. About 10 s.
//   errors   unknown contracts, missing parameters and response headers. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/omnix/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://futuresopenapi.coinchief.live';
const FAPI_CMC_HOST = 'https://futuresopenapi.coinchief.work'; // the host the venue's CMC-api page names
const WEB = 'https://www.coinchief.live';
const OMNIX = 'https://www.omnix.vin';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

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

const post = (url, body) => get(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function host() {
  for (const h of ['futuresopenapi.coinchief.live', 'futuresopenapi.coinchief.work', 'futuresws.coinchief.live', 'www.coinchief.live', 'www.omnix.vin', 'openapi.omnix.vin']) {
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
  const via = (await get(`${FAPI}/fapi/v1/ping`)).headers;
  log('headers', { server: via.get('server'), via: via.get('via'), cache: via.get('x-site-cache-status') });
  const checks = [
    ['GET', `${OMNIX}/`],
    ['POST', `${OMNIX}/fe-ex-api/common/public_info`],
    ['POST', `${OMNIX}/fe-co-api/common/public_info`],
    ['GET', 'https://openapi.omnix.vin/sapi/v1/ping'],
    ['GET', 'https://futuresopenapi.omnix.vin/fapi/v1/ping'],
    ['GET', `${FAPI}/fapi/v1/ping`],
    ['GET', `${FAPI_CMC_HOST}/fapi/v1/ping`],
    ['GET', 'https://openapi.coinchief.live/sapi/v1/ping'],
    ['POST', `${WEB}/fe-co-api/common/public_info`],
  ];
  for (const [m, u] of checks) {
    const r = m === 'POST' ? await post(u, {}) : await get(u);
    const cfRay = r.headers.get('cf-ray');
    log('access', { method: m, url: u, status: r.status, ms: r.ms, bytes: r.bytes, cfRay, head: r.body.slice(0, 90).replace(/\s+/g, ' ') });
    if (u.endsWith('fe-ex-api/common/public_info') && r.json?.data) {
      const d = r.json.data;
      log('omnix_config', { company_name: d.company_name, base_url: d.base_url, wsUrl: d.wsUrl, open_api_url: d.open_api_url, contractOpen: d.contractOpen, limitCountryList: d.limitCountryList });
    }
  }
  // The venue's own notice list, the same call its web front makes, for the rebrand date and any fee notice.
  const n = await post(`${WEB}/fe-ex-api/notice/notice_info_list`, { page: 1, pageSize: 20 });
  for (const x of n.json?.data?.noticeInfoList ?? []) log('notice', { id: x.id, at: new Date(x.timeLong).toISOString(), title: x.title.slice(0, 110) });
}

async function catalog() {
  const oa = await get(`${FAPI}/fapi/v1/contracts`);
  keep('contracts.json', oa.body);
  const rows = oa.json;
  const count = (xs, f) => Object.entries(xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' ');
  log('contracts', { status: oa.status, ms: oa.ms, bytes: oa.bytes, n: rows.length, status_: count(rows, (r) => r.status), type: count(rows, (r) => r.type), side: count(rows, (r) => r.side), quote: count(rows, (r) => r.symbol.split('-')[2]) });
  log('contracts_multiplier', { byMultiplier: count(rows, (r) => Number(r.multiplier)), sample: rows.filter((r) => ['E-BTC-USDT', 'E-ETH-USDT', 'E-SYNX-USDT', 'E-YFI-USDT'].includes(r.symbol)).map((r) => ({ s: r.symbol, m: Number(r.multiplier), coin: r.multiplierCoin, minVol: r.minOrderVolume, pp: r.pricePrecision })) });
  const bases = rows.map((r) => r.symbol.split('-')[1]);
  log('pairs_twice', { dup: bases.filter((b, i) => bases.indexOf(b) !== i) });

  const web = await post(`${WEB}/fe-co-api/common/public_info`, {});
  keep('co_public_info.json', web.body);
  const wl = web.json.data.contractList;
  log('web_contracts', { status: web.status, ms: web.ms, bytes: web.bytes, n: wl.length, wsUrl: web.json.data.wsUrl, capitalFrequency: count(wl, (c) => c.capitalFrequency), settlementFrequency: count(wl, (c) => c.settlementFrequency), maxLever: count(wl, (c) => c.maxLever), sample: wl.filter((c) => c.contractName === 'E-BTC-USDT').map((c) => ({ contractName: c.contractName, symbol: c.symbol, subSymbol: c.subSymbol, contractOtherName: c.contractOtherName, multiplier: Number(c.multiplier), marginCoin: c.marginCoin, depth: c.coinResultVo?.depth })) });
  const webNames = new Set(wl.map((c) => c.contractName));
  log('only_in_openapi', { names: rows.map((r) => r.symbol).filter((s) => !webNames.has(s)) });
  log('only_in_web', { names: wl.map((c) => c.contractName).filter((s) => !rows.some((r) => r.symbol === s)) });

  const cmc = await get(`${FAPI}/cmc/specifications`);
  keep('cmc_specifications.json', cmc.body);
  const btc = cmc.json.find((r) => r.ticker_id === 'BTC-USDT');
  log('cmc_btc', { last_price: btc.last_price, base_volume: btc.base_volume, quote_volume: btc.quote_volume, open_interest: btc.open_interest, open_interest_usd: btc.open_interest_usd, index_price: btc.index_price, funding_rate: btc.funding_rate, next_funding_rate: btc.next_funding_rate });
  log('cmc_specifications', { status: cmc.status, ms: cmc.ms, bytes: cmc.bytes, n: cmc.json.length, fields: Object.keys(cmc.json[0]), maker: count(cmc.json, (r) => r.maker_fee), taker: count(cmc.json, (r) => r.taker_fee), contractType: count(cmc.json, (r) => r.contract_type) });

  const spot = await get('https://openapi.coinchief.live/sapi/v1/symbols');
  log('spot_symbols', { status: spot.status, n: spot.json?.symbols?.length, quote: count(spot.json?.symbols ?? [], (s) => s.quoteAsset) });

  for (const id of ['omnix', 'coinchief', 'chainup', 'bitrue']) log('ccxt', { id, present: ccxt.exchanges.includes(id) });
  log('ccxt_version', { version: ccxt.version, exchanges: ccxt.exchanges.length });
}

const DEV = (a, b) => (b ? Math.round(((a - b) / b) * 1e6) : null); // ppm

async function anchor() {
  const contracts = (await get(`${FAPI}/fapi/v1/contracts`)).json.map((r) => r.symbol);
  const specs = (await get(`${FAPI}/cmc/specifications`)).json;
  const last = new Map(specs.map((s) => [s.ticker_id, s]));
  const t0 = performance.now();
  const rows = [];
  for (let i = 0; i < contracts.length; i += 3) {
    const part = await Promise.all(contracts.slice(i, i + 3).map(async (c) => ({ c, r: await get(`${FAPI}/fapi/v1/index?contractName=${c}`) })));
    rows.push(...part);
    await sleep(100);
  }
  const roundMs = Math.round(performance.now() - t0);
  const fieldSets = new Set(rows.map(({ r }) => Object.keys(r.json ?? {}).join(',')));
  const statuses = [...new Set(rows.map(({ r }) => r.status))];
  log('index_round', { n: rows.length, roundMs, statuses, fieldSets: [...fieldSets], medianMs: rows.map(({ r }) => r.ms).sort((a, b) => a - b)[rows.length >> 1] });
  keep('index_round.json', JSON.stringify(rows.map(({ c, r }) => ({ c, ...r.json }))));
  const offs = rows.map(({ c, r }) => {
    const s = last.get(c.slice(2));
    const lp = s?.last_price;
    return { c, index: r.json?.indexPrice, tag: r.json?.tagPrice, last: lp, idxVsLastPpm: DEV(r.json?.indexPrice, lp), tagVsIdxPpm: DEV(r.json?.tagPrice, r.json?.indexPrice), cur: r.json?.currentFundRate, next: r.json?.nextFundRate, specIdx: s?.index_price, nft: s?.next_funding_rate_timestamp };
  });
  const bad = offs.filter((o) => Math.abs(o.idxVsLastPpm ?? 0) > 20_000);
  log('index_vs_last', { over2pct: bad.length, of: offs.length, worst: bad.sort((a, b) => Math.abs(b.idxVsLastPpm) - Math.abs(a.idxVsLastPpm)).slice(0, 12).map((o) => `${o.c} idx=${o.index} last=${o.last} ${o.idxVsLastPpm}ppm`) });
  log('index_close', { within2pct: offs.filter((o) => Math.abs(o.idxVsLastPpm ?? 1e9) <= 20_000).map((o) => `${o.c}:${o.idxVsLastPpm}`) });
  const cnt = (f) => Object.entries(offs.reduce((m, o) => ((m[f(o)] = (m[f(o)] ?? 0) + 1), m), {})).map(([k, v]) => `${k}:${v}`).join(' ');
  log('funding_values', { currentFundRate: cnt((o) => o.cur), nextFundRate: cnt((o) => o.next) });
  log('spec_next_funding_ts', { values: cnt((o) => (o.nft ? new Date(o.nft).toISOString() : o.nft)), specIdxEqualsIndex: offs.filter((o) => o.specIdx === o.index).length });

  // An outside reference: Gate's public USDT perpetual index, one bulk read, to tell a stale OmniX index from a live one.
  const gate = await get('https://api.gateio.ws/api/v4/futures/usdt/tickers');
  const gateIdx = new Map(gate.json.map((t) => [t.contract, Number(t.index_price)]));
  const ref = offs.map((o) => ({ ...o, gate: gateIdx.get(o.c.slice(2).replace('-', '_')) })).map((o) => ({ ...o, idxVsGatePpm: DEV(o.index, o.gate), lastVsGatePpm: DEV(o.last, o.gate) }));
  const stale = ref.filter((o) => o.gate && Math.abs(o.idxVsGatePpm) > 20_000);
  const live = ref.filter((o) => o.gate && Math.abs(o.idxVsGatePpm) <= 20_000);
  log('index_vs_gate', { gateStatus: gate.status, withGate: ref.filter((o) => o.gate).length, noGate: ref.filter((o) => !o.gate).map((o) => o.c), idxOff2pct: stale.length, idxWithin2pct: live.length, lastWithin1pct: ref.filter((o) => o.gate && Math.abs(o.lastVsGatePpm) <= 10_000).length });
  log('stale_detail', { nextFundingTs: [...new Set(stale.map((o) => o.nft))].map((t) => (t ? new Date(t).toISOString() : t)), names: stale.map((o) => `${o.c}:${o.idxVsGatePpm}`) });
  log('live_detail', { nextFundingTs: [...new Set(live.map((o) => o.nft))].map((t) => (t ? new Date(t).toISOString() : t)), idxEqualsLast: live.filter((o) => o.index === o.last).length, names: live.map((o) => `${o.c}:${o.idxVsGatePpm}`) });
  log('watch_rows', { rows: ref.filter((o) => ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-UNI-USDT', 'E-AAVE-USDT', 'E-DYDX-USDT'].includes(o.c)).map((o) => `${o.c} idx=${o.index} last=${o.last} gate=${o.gate} ${o.idxVsGatePpm}ppm`) });
  log('tag_vs_index', { maxAbsPpm: Math.max(...ref.filter((o) => o.tagVsIdxPpm !== null).map((o) => Math.abs(o.tagVsIdxPpm))), sample: ref.slice(0, 6).map((o) => `${o.c}:${o.tagVsIdxPpm}`) });

  const watch = ['E-BTC-USDT', 'E-ETH-USDT', 'E-SOL-USDT', 'E-SYNX-USDT'];
  const hist = Object.fromEntries(watch.map((c) => [c, { index: new Set(), tag: new Set(), cur: new Set(), next: new Set(), ms: [] }]));
  const specHist = { idx: new Map(), last: new Map(), ms: [] };
  const start = Date.now();
  let tick = 0;
  while (Date.now() - start < 60_000) {
    const tt = Date.now();
    const got = await Promise.all(watch.map((c) => get(`${FAPI}/fapi/v1/index?contractName=${c}`).then((r) => ({ c, r }))));
    for (const { c, r } of got) {
      const h = hist[c];
      h.index.add(r.json?.indexPrice); h.tag.add(r.json?.tagPrice); h.cur.add(r.json?.currentFundRate); h.next.add(r.json?.nextFundRate); h.ms.push(r.ms);
    }
    if (tick % 5 === 0) {
      const s = await get(`${FAPI}/cmc/specifications`);
      specHist.ms.push(s.ms);
      for (const row of s.json) {
        if (!watch.includes(`E-${row.ticker_id}`)) continue;
        if (!specHist.idx.has(row.ticker_id)) { specHist.idx.set(row.ticker_id, new Set()); specHist.last.set(row.ticker_id, new Set()); }
        specHist.idx.get(row.ticker_id).add(row.index_price); specHist.last.get(row.ticker_id).add(row.last_price);
      }
    }
    tick++;
    await sleep(Math.max(0, 1000 - (Date.now() - tt)));
  }
  for (const c of watch) {
    const h = hist[c];
    const ms = h.ms.sort((a, b) => a - b);
    log('poll_1s', { c, polls: ms.length, distinctIndex: h.index.size, distinctTag: h.tag.size, distinctCur: h.cur.size, distinctNext: h.next.size, indexValues: [...h.index].slice(0, 4), msMin: ms[0], msMedian: ms[ms.length >> 1], msMax: ms[ms.length - 1] });
  }
  const sms = specHist.ms.sort((a, b) => a - b);
  log('spec_5s', { polls: sms.length, msMin: sms[0], msMedian: sms[sms.length >> 1], msMax: sms[sms.length - 1], distinct: [...specHist.idx.keys()].map((k) => `${k} idx:${specHist.idx.get(k).size} last:${specHist.last.get(k).size}`) });
  const cmcHost = await get(`${FAPI_CMC_HOST}/cmc/specifications`);
  log('spec_other_host', { url: `${FAPI_CMC_HOST}/cmc/specifications`, status: cmcHost.status, ms: cmcHost.ms, n: cmcHost.json?.length });
}

async function book() {
  for (const limit of [5, 20, 100, 200]) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const b = r.json;
    const desc = b.bids.every((l, i) => i === 0 || l[0] < b.bids[i - 1][0]);
    const asc = b.asks.every((l, i) => i === 0 || l[0] > b.asks[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: b.bids.length, asks: b.asks.length, bidsDescending: desc, asksAscending: asc, time: b.time, numberTypes: typeof b.bids[0][0] + '/' + typeof b.bids[0][1], top: [b.bids[0], b.asks[0]] });
  }
  const r0 = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT`);
  log('depth_default', { bids: r0.json.bids.length, asks: r0.json.asks.length });
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-ETH-USDT&limit=5`);
    times.push({ at: Date.now() % 100000, time: r.json.time % 100000, bid: r.json.bids[0].join('@') });
    await sleep(250);
  }
  log('depth_repeat', { reads: times });
  for (const c of ['E-SYNX-USDT', 'E-YFI-USDT', 'E-MATIC-USDT']) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=${c}&limit=100`);
    log('depth_thin', { c, status: r.status, bids: r.json?.bids?.length, asks: r.json?.asks?.length, spreadPpm: r.json?.bids?.length && r.json?.asks?.length ? DEV(r.json.asks[0][0], r.json.bids[0][0]) : null, body: r.json?.bids ? undefined : r.body.slice(0, 120) });
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
    `${FAPI}/cmc/summary/NOPE-USDT`,
    `${FAPI}/cmc/summary/BTC-USDT`,
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
