// x.me futures REST probe: host and latency, catalog, anchor calls and how often they change, one full anchor round, the REST book, error shapes, and the clock.
// Public, unauthenticated, read-only. The open API host needs no key for these calls, and the website's own fe-co-api calls are read the way its futures page reads them.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/x-me/rest-probe.mjs [latency|catalog|anchor|round|depth|errors|time]
//   latency  DNS, then cold and warm request times for the open API and the website API. About 40 s.
//   catalog  the open API contracts list against the website contract list: status, multiplier, funding interval, next settlement, channel symbol, pairs twice, spot count.
//   anchor   four perps polled once a second for 60 s, alternating the open API index call and the website public_market_info call, plus the index basket and the settled funding history.
//   round    one public_market_info call for every active perp, two at a time, to time a full anchor round.
//   depth    the REST book at several limits, level order, and the website depth_map.
//   errors   unknown, closed and missing contract, bad limit, unknown path, and the rate limit headers.
//   time     ten server time reads and the clock offset.
// Recorded in docs/profiles/x-me/rest.md.
import { lookup } from 'node:dns/promises';

const OPEN = 'https://futuresopenapi.x.me/fapi/v1';
const WEB = 'https://www.x.me/fe-co-api';
const SPOT = 'https://openapi.x.me/sapi/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (arr, p) => (arr.length ? [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
const stats = (arr) => ({ n: arr.length, min: q(arr, 0), med: q(arr, 0.5), p90: q(arr, 0.9), max: q(arr, 1) });

async function get(url, init) {
  const t = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t);
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, ms, bytes: text.length, json, text, headers: Object.fromEntries(res.headers) };
}
const post = (path, body) => get(`${WEB}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'exchange-language': 'en_US' }, body: JSON.stringify(body) });

async function latency() {
  for (const h of ['futuresopenapi.x.me', 'www.x.me', 'futuresws.x.me', 'openapi.x.me']) {
    const t = performance.now();
    const addrs = await lookup(h, { all: true });
    log('dns', { host: h, ms: Math.round(performance.now() - t), addrs: addrs.map((a) => a.address) });
  }
  const open = [], web = [], contracts = [];
  for (let i = 0; i < 10; i++) {
    open.push((await get(`${OPEN}/time`)).ms);
    web.push((await post('common/public_market_info', { contractId: 48 })).ms);
    await sleep(300);
  }
  for (let i = 0; i < 3; i++) contracts.push(await get(`${OPEN}/contracts`));
  const pinfo = await post('common/public_info', {});
  log('latency', {
    openTimeMs: { first: open[0], warm: stats(open.slice(1)) }, webMarketInfoMs: { first: web[0], warm: stats(web.slice(1)) },
    contracts: contracts.map((r) => ({ ms: r.ms, bytes: r.bytes })), publicInfo: { ms: pinfo.ms, bytes: pinfo.bytes },
    server: contracts[0].headers.server, cache: contracts[0].headers['eo-cache-status'] ?? null,
  });
}

async function catalog() {
  const open = (await get(`${OPEN}/contracts`)).json;
  const web = (await post('common/public_info', {})).json.data;
  const wl = new Map(web.contractList.map((c) => [c.contractName, c]));
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  const active = open.filter((c) => c.status === 1);
  const inactive = open.filter((c) => c.status !== 1);
  const mismatches = [];
  for (const c of active) {
    const w = wl.get(c.symbol);
    if (!w) { mismatches.push(`${c.symbol} missing from website list`); continue; }
    if (w.id !== c.contractId) mismatches.push(`${c.symbol} id ${c.contractId} vs ${w.id}`);
    if (Number(w.multiplier) !== Number(c.multiplier)) mismatches.push(`${c.symbol} multiplier ${c.multiplier} vs ${w.multiplier}`);
    if (w.subSymbol !== `e_${w.base.toLowerCase()}usdt`) mismatches.push(`${c.symbol} subSymbol ${w.subSymbol}`);
  }
  const inWebNotActive = web.contractList.filter((w) => !active.some((c) => c.symbol === w.contractName)).map((w) => w.contractName);
  const bases = count(active, (c) => c.multiplierCoin);
  log('catalog', {
    openTotal: open.length, openKeys: Object.keys(open[0]), status: count(open, (c) => c.status), side: count(open, (c) => c.side), type: count(open, (c) => c.type),
    activeQuote: count(active, (c) => c.symbol.split('-')[2]), activeMultiplier: count(active, (c) => c.multiplier),
    webTotal: web.contractList.length, webMarginCoins: web.marginCoinList, webWsUrl: web.wsUrl, mismatches: mismatches.slice(0, 10), mismatchCount: mismatches.length, inWebNotActive,
    fundingHours: count(web.contractList, (c) => c.capitalFrequency), nextSettlement: count(web.contractList, (c) => new Date(c.nextCapitalSettTime).toISOString()),
    settlementFrequency: count(web.contractList, (c) => c.settlementFrequency), deliveryKind: count(web.contractList, (c) => c.deliveryKind), contractSide: count(web.contractList, (c) => c.contractSide),
    basesListedTwice: Object.entries(bases).filter(([, n]) => n > 1), inactiveSample: inactive.slice(0, 12).map((c) => c.symbol), inactiveCount: inactive.length,
    namesWithDigits: active.filter((c) => /\d/.test(c.multiplierCoin)).map((c) => c.symbol).slice(0, 12),
    maxLever: count(web.contractList, (c) => c.maxLever),
  });
  const spot = await get(`${SPOT}/symbols`);
  log('spot_catalog', { status: spot.status, bytes: spot.bytes, symbols: spot.json?.symbols?.length ?? null, sample: spot.json?.symbols?.[0] ?? spot.text.slice(0, 200) });
}

async function anchor() {
  const names = { 'E-BTC-USDT': 48, 'E-ETH-USDT': null, 'E-TRX-USDT': 50, 'E-DOS-USDT': 370 };
  const open = (await get(`${OPEN}/contracts`)).json;
  for (const n of Object.keys(names)) names[n] = open.find((c) => c.symbol === n).contractId;
  const web = (await post('common/public_info', {})).json.data.contractList;
  for (const n of Object.keys(names)) {
    const w = web.find((c) => c.contractName === n);
    const basket = await post('common/index_price_weight_list', { contractId: names[n] });
    const hist = await post('common/funding_rate_list', { contractId: names[n], page: 1, limit: 6 });
    log('basket_and_history', {
      contract: n, contractId: names[n], fundingHours: w.capitalFrequency, nextSettlement: new Date(w.nextCapitalSettTime).toISOString(),
      basket: basket.json?.data?.records, history: (hist.json?.data?.historyList ?? []).map((h) => [new Date(h.ctime).toISOString(), h.amount]), historyCode: hist.json?.code,
    });
    await sleep(300);
  }
  const series = Object.fromEntries(Object.keys(names).map((n) => [n, { open: [], web: [] }]));
  const openMs = [], webMs = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    await Promise.all(Object.entries(names).map(async ([n, id]) => {
      if (i % 2 === 0) {
        const r = await get(`${OPEN}/index?contractName=${n}`);
        openMs.push(r.ms);
        if (r.json) series[n].open.push({ at: Date.now() - t0, ...r.json });
      } else {
        const r = await post('common/public_market_info', { contractId: id });
        webMs.push(r.ms);
        if (r.json?.data) series[n].web.push({ at: Date.now() - t0, ...r.json.data });
      }
    }));
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  const changes = (arr, k) => arr.reduce((c, x, i) => c + (i && x[k] !== arr[i - 1][k] ? 1 : 0), 0);
  for (const [n, s] of Object.entries(series)) {
    const all = [...s.open, ...s.web].sort((a, b) => a.at - b.at);
    const last = all[all.length - 1];
    log('anchor_series', {
      contract: n, openPolls: s.open.length, webPolls: s.web.length,
      openChanges: { index: changes(s.open, 'indexPrice'), mark: changes(s.open, 'tagPrice'), current: changes(s.open, 'currentFundRate'), next: changes(s.open, 'nextFundRate') },
      webChanges: { index: changes(s.web, 'indexPrice'), mark: changes(s.web, 'tagPrice'), current: changes(s.web, 'currentFundRate'), next: changes(s.web, 'nextFundRate') },
      mergedChanges: { index: changes(all, 'indexPrice'), mark: changes(all, 'tagPrice') },
      currentEqualsNext: all.filter((x) => x.currentFundRate === x.nextFundRate).length, samples: all.length,
      markPremiumPpm: { min: Math.round(Math.min(...all.map((x) => (x.tagPrice / x.indexPrice - 1) * 1e6))), max: Math.round(Math.max(...all.map((x) => (x.tagPrice / x.indexPrice - 1) * 1e6))) },
      last: { indexPrice: last.indexPrice, tagPrice: last.tagPrice, currentFundRate: last.currentFundRate, nextFundRate: last.nextFundRate },
      keys: Object.keys(s.open[0] || {}).filter((k) => k !== 'at'),
    });
  }
  log('anchor_times', { openIndexMs: stats(openMs), webMarketInfoMs: stats(webMs) });
}

async function round() {
  const open = (await get(`${OPEN}/contracts`)).json.filter((c) => c.status === 1);
  const t0 = Date.now();
  const ms = [];
  const errs = {};
  let rows = 0;
  let i = 0;
  const rates = [];
  const worker = async () => {
    while (i < open.length) {
      const c = open[i++];
      const r = await post('common/public_market_info', { contractId: c.contractId });
      ms.push(r.ms);
      if (r.json?.code === '0' && r.json.data?.tagPrice > 0) { rows++; rates.push([c.symbol, r.json.data.currentFundRate, Math.round((r.json.data.tagPrice / r.json.data.indexPrice - 1) * 1e6)]); }
      else errs[r.status + ' ' + (r.json?.code ?? '')] = (errs[r.status + ' ' + (r.json?.code ?? '')] || 0) + 1;
    }
  };
  await Promise.all([worker(), worker()]);
  log('round', { contracts: open.length, rowsWithMark: rows, errors: errs, wallMs: Date.now() - t0, perCallMs: stats(ms) });
  rates.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  log('round_rates', { largestAbsRate: rates.slice(0, 8), largestAbsPremiumPpm: [...rates].sort((a, b) => Math.abs(b[2]) - Math.abs(a[2])).slice(0, 8) });
}

async function depth() {
  for (const limit of [5, 30, 50, 100, 200, 1000]) {
    const r = await get(`${OPEN}/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const b = r.json?.bids ?? [], a = r.json?.asks ?? [];
    const bidDesc = b.every((l, i) => !i || l[0] < b[i - 1][0]);
    const askAsc = a.every((l, i) => !i || l[0] > a[i - 1][0]);
    log('depth', { limit, status: r.status, ms: r.ms, levels: [b.length, a.length], bidDesc, askAsc, time: r.json?.time, keys: r.json ? Object.keys(r.json) : null, cache: r.headers['cache-control'] ?? null, top: [b[0], a[0]], body: r.json ? undefined : r.text.slice(0, 200) });
    await sleep(300);
  }
  const a = await get(`${OPEN}/depth?contractName=E-BTC-USDT&limit=30`);
  const b = await get(`${OPEN}/depth?contractName=E-BTC-USDT&limit=30`);
  log('depth_repeat', { identical: a.text === b.text, ms: [a.ms, b.ms] });
  const dm = await post('common/depth_map', { contractId: 48 });
  const d = dm.json?.data ?? {};
  log('depth_map', { ms: dm.ms, bytes: dm.bytes, keys: Object.keys(d), buys: d.buys?.length, asks: d.asks?.length, firstBuys: d.buys?.slice(0, 3), firstAsks: d.asks?.slice(0, 3) });
}

async function errors() {
  const cases = [
    ['index unknown', `${OPEN}/index?contractName=E-NOPE-USDT`],
    ['index closed', `${OPEN}/index?contractName=E-XTZ-USDT`],
    ['index missing param', `${OPEN}/index`],
    ['index lower case', `${OPEN}/index?contractName=e-btc-usdt`],
    ['depth unknown', `${OPEN}/depth?contractName=E-NOPE-USDT&limit=5`],
    ['depth closed', `${OPEN}/depth?contractName=E-XTZ-USDT&limit=5`],
    ['depth limit 0', `${OPEN}/depth?contractName=E-BTC-USDT&limit=0`],
    ['depth no limit', `${OPEN}/depth?contractName=E-BTC-USDT`],
    ['ticker closed', `${OPEN}/ticker?contractName=E-XTZ-USDT`],
    ['unknown path', `${OPEN}/nope`],
    ['tickers', `${OPEN}/tickers`],
  ];
  for (const [label, url] of cases) {
    const r = await get(url);
    log('error_case', { label, status: r.status, ms: r.ms, body: r.text.slice(0, 220) });
    await sleep(300);
  }
  for (const [label, body] of [['market info unknown id', { contractId: 999999 }], ['market info closed id 98', { contractId: 98 }], ['market info no body', {}]]) {
    const r = await post('common/public_market_info', body);
    log('error_case', { label, status: r.status, ms: r.ms, body: r.text.slice(0, 220) });
  }
  const r = await get(`${OPEN}/index?contractName=E-BTC-USDT`);
  log('headers', { headers: r.headers });
}

async function time() {
  const offsets = [], rtts = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await get(`${OPEN}/time`);
    const t1 = Date.now();
    offsets.push(r.json.serverTime - (t0 + t1) / 2);
    rtts.push(t1 - t0);
    if (i === 0) log('time_reply', { body: r.json });
    await sleep(300);
  }
  const sp = await get(`${SPOT}/time`);
  log('time', { offsetMs: stats(offsets.map(Math.round)), rttMs: stats(rtts), spotTime: sp.json });
}

const mode = process.argv[2] || 'latency';
const modes = { latency, catalog, anchor, round, depth, errors, time };
if (!modes[mode]) { console.error(`unknown mode ${mode}`); process.exit(1); }
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
