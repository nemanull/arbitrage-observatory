// Bitrue futures REST probe: host and latency, the contracts catalog and how CCXT maps it, the anchor calls, the REST book, error shapes and server time.
// Public, unauthenticated and read-only.
// The official API has no bulk index or mark, so the anchor mode also reads the funding list the futures web page itself calls without login.
// Every loop keeps at least one second between two requests to the same URL, and the survey stays near 5 requests per second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitrue/rest-probe.mjs [main|anchor|survey]
//   main    host, catalog through CCXT, REST book, error shapes, the web contract and funding lists, funding history and server time, about 50 s
//   anchor  60 one second rounds of /fapi/v1/index on four contracts plus the web funding list, about 70 s
//   survey  /fapi/v1/index once for every USDT-M and USDC-M contract at about 5 per second, about 160 s
// Set PROBE_OUT_DIR to keep raw replies.
// Recorded in docs/profiles/bitrue/rest.md and docs/profiles/bitrue/fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://fapi.bitrue.com';
const WEB = 'https://futures.bitrue.com/fe-co-api';
const OUT = process.env.PROBE_OUT_DIR;
const TRACKED = ['E-BTC-USDT', 'E-ETH-USDT', 'E-LSK-USDT', 'E-BTC-USDC'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const tally = (rows, f) => { const c = {}; for (const r of rows) { const k = String(f(r)); c[k] = (c[k] ?? 0) + 1; } return c; };
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: Math.round(s[0]), median: Math.round(q(0.5)), p90: Math.round(q(0.9)), max: Math.round(s[s.length - 1]) };
};

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body));
}

async function get(url, init = {}) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { accept: 'application/json', 'content-type': 'application/json' }, ...init });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch {}
  const headers = {};
  for (const [k, v] of res.headers) if (/limit|retry|cache|age|date|x-amz-cf-pop|server/i.test(k)) headers[k] = v;
  return { status: res.status, ttfb, ms, bytes: text.length, text, json, headers };
}

const post = (url, body) => get(url, { method: 'POST', body: JSON.stringify(body) });

async function host() {
  for (const h of ['fapi.bitrue.com', 'futures.bitrue.com', 'fmarket-ws.bitrue.com', 'futuresws.bitrue.com']) {
    try {
      const a = await dns.lookup(h, { all: true });
      let cname = null;
      try { cname = await dns.resolveCname(h); } catch {}
      log('dns', { host: h, cname, addresses: a.map((x) => x.address) });
    } catch (e) { log('dns', { host: h, error: e.code }); }
  }
  const t = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${FAPI}/fapi/v1/time`);
    t.push({ i, status: r.status, ttfb: Math.round(r.ttfb), ms: Math.round(r.ms), cache: r.headers['x-cache'], pop: r.headers['x-amz-cf-pop'] });
    await sleep(1000);
  }
  log('time_calls', { first_is_cold: t[0], warm: t.slice(1).map((x) => x.ms) });
}

async function catalog() {
  const lin = await get(`${FAPI}/fapi/v1/contracts`);
  const inv = await get(`${FAPI}/fapi/v1/contracts`.replace('/fapi/', '/dapi/'));
  save('contracts-fapi.json', lin.text);
  save('contracts-dapi.json', inv.text);
  for (const [name, r] of [['fapi', lin], ['dapi', inv]]) {
    log('contracts', {
      family: name, status: r.status, bytes: r.bytes, ms: Math.round(r.ms), rows: r.json.length,
      by_type_side_status_quote: tally(r.json, (c) => [c.type, c.side, c.status, c.symbol.split('-')[2]].join('|')),
      multipliers: Object.keys(tally(r.json, (c) => c.multiplier)).length,
    });
  }
  const again = await get(`${FAPI}/fapi/v1/contracts`);
  log('contracts_warm', { ms: Math.round(again.ms), cache: again.headers['x-cache'] });

  const ex = new ccxt.bitrue();
  const t0 = performance.now();
  await ex.loadMarkets();
  const ms = Math.round(performance.now() - t0);
  const swaps = Object.values(ex.markets).filter((m) => m.swap);
  log('ccxt_load', {
    version: ccxt.version, ms, markets: Object.keys(ex.markets).length, swaps: swaps.length,
    swap_active: tally(swaps, (m) => m.active), swap_linear: tally(swaps, (m) => m.linear),
    swap_taker: tally(swaps, (m) => m.taker), swap_maker: tally(swaps, (m) => m.maker),
    spot_taker: tally(Object.values(ex.markets).filter((m) => m.spot), (m) => m.taker),
    status_field: tally(swaps, (m) => typeof m.info.status + ':' + m.info.status),
  });
  const byRaw = new Map([...lin.json, ...inv.json].map((c) => [c.symbol, c]));
  let sizeMatch = 0;
  const sizeMismatch = [];
  for (const m of swaps) {
    const c = byRaw.get(m.id);
    if (c && Number(c.multiplier) === m.contractSize) sizeMatch++; else sizeMismatch.push(m.id);
  }
  log('ccxt_contract_size', { match: sizeMatch, mismatch: sizeMismatch.slice(0, 10) });
  const sample = ['BTC/USDT:USDT', 'BTC/USDC:USDC', 'BTC/USD:BTC', '1000PEPE/USDT:USDT'].map((s) => {
    const m = ex.markets[s];
    return m && { symbol: s, id: m.id, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, active: m.active, contractSize: m.contractSize, taker: m.taker, maker: m.maker };
  });
  log('ccxt_sample', { sample });
  const wsIds = tally(swaps, (m) => 'e_' + m.baseId.toLowerCase() + m.quoteId.toLowerCase());
  log('ws_id_collisions', { distinct: Object.keys(wsIds).length, swaps: swaps.length, collisions: Object.entries(wsIds).filter(([, n]) => n > 1).map(([k]) => k).slice(0, 10) });
  const byBase = tally(swaps, (m) => m.base);
  log('pairs_listed_twice', { bases_with_more_than_one_swap: Object.values(byBase).filter((n) => n > 1).length, examples: Object.entries(byBase).filter(([, n]) => n > 2).map(([k]) => k).slice(0, 10) });
  const odd = swaps.filter((m) => !/^[A-Z0-9]+$/.test(m.baseId));
  log('odd_base_ids', { count: odd.length, ids: odd.map((m) => m.id).slice(0, 12) });
  const prefixed = swaps.filter((m) => /^(1000|10000|1000000|1M)/.test(m.baseId)).map((m) => m.id);
  log('scaled_bases', { count: prefixed.length, ids: prefixed });
}

async function book() {
  for (const limit of [5, 30, 100, 200]) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=${limit}`);
    const j = r.json ?? {};
    const bids = j.bids ?? [];
    const asks = j.asks ?? [];
    const desc = bids.every((l, i) => i === 0 || Number(l[0]) < Number(bids[i - 1][0]));
    const asc = asks.every((l, i) => i === 0 || Number(l[0]) > Number(asks[i - 1][0]));
    log('rest_depth', { limit, status: r.status, ms: Math.round(r.ms), bids: bids.length, asks: asks.length, bids_desc: desc, asks_asc: asc, time: j.time, first: [bids[0], asks[0]], types: [typeof bids[0]?.[0], typeof bids[0]?.[1]], body: r.json ? undefined : r.text.slice(0, 200), keys: Object.keys(j) });
    await sleep(300);
  }
  const times = [];
  for (let i = 0; i < 5; i++) {
    const r = await get(`${FAPI}/fapi/v1/depth?contractName=E-BTC-USDT&limit=100`);
    times.push({ t: r.json?.time, recv: Date.now(), cache: r.headers['x-cache'], top: r.json?.bids?.[0]?.join('@') });
    await sleep(250);
  }
  log('rest_depth_repeat', { times });
}

async function errors() {
  const cases = [
    ['index_no_param', `${FAPI}/fapi/v1/index`],
    ['index_unknown', `${FAPI}/fapi/v1/index?contractName=E-NOPE-USDT`],
    ['index_lowercase', `${FAPI}/fapi/v1/index?contractName=e-btc-usdt`],
    ['index_spot_style', `${FAPI}/fapi/v1/index?contractName=BTCUSDT`],
    ['depth_no_param', `${FAPI}/fapi/v1/depth`],
    ['depth_unknown', `${FAPI}/fapi/v1/depth?contractName=E-NOPE-USDT`],
    ['ticker_ok', `${FAPI}/fapi/v1/ticker?contractName=E-BTC-USDT`],
    ['unknown_path', `${FAPI}/fapi/v1/nope`],
    ['premium_index', `${FAPI}/fapi/v1/premiumIndex`],
    ['funding_rate', `${FAPI}/fapi/v1/fundingRate?contractName=E-BTC-USDT`],
    ['web_funding_no_symbol', `${WEB}/common/funding_rate_real_time`],
  ];
  for (const [name, url] of cases) {
    const r = await get(url);
    log('error_shape', { name, status: r.status, ms: Math.round(r.ms), body: r.text.slice(0, 220), headers: r.headers });
    await sleep(300);
  }
}

async function history() {
  const r = await post(`${WEB}/common/funding_rate_history`, { symbol: 'BTC-USDT', page: 1, rows: 6 });
  const recs = r.json?.data?.records ?? [];
  log('funding_history', { status: r.status, ms: Math.round(r.ms), keys: recs[0] && Object.keys(recs[0]), rows: recs.map((x) => ({ at: new Date(x.calcTime).toISOString(), rate: x.lastFundingRate, mark: x.markPrice, h: x.fundingIntervalHours })) });
  await sleep(300);
  const r2 = await post(`${WEB}/common/funding_rate_history`, { symbol: 'LSK-USDT', page: 1, rows: 4 });
  log('funding_history_hourly', { status: r2.status, rows: (r2.json?.data?.records ?? []).map((x) => ({ at: new Date(x.calcTime).toISOString(), rate: x.lastFundingRate, h: x.fundingIntervalHours })) });
}

// The futures web page reads its contract list, with each contract's opening and closing taker rate, from this call without login.
async function webContracts() {
  const r = await post(`${WEB}/common/public_info`, { type: '1,2,3,4', showStatus: '1,2' });
  const cl = r.json?.data?.contractList ?? [];
  const api = new Set((await get(`${FAPI}/fapi/v1/contracts`)).json.map((c) => c.symbol));
  const shown = new Set(cl.map((c) => c.contractName));
  const hidden = [...api].filter((s) => !shown.has(s));
  log('web_contracts', {
    status: r.status, ms: Math.round(r.ms), bytes: r.bytes, rows: cl.length, wsUrl: r.json?.data?.wsUrl,
    by_tab: tally(cl, (c) => c.firstTab), show_type: tally(cl, (c) => c.contractShowType),
    taker_open_close_by_tab: tally(cl, (c) => `${c.firstTab} ${c.openTakerFeeRate}/${c.closeTakerFeeRate}`),
    not_the_common_rate: cl.filter((c) => !(c.openTakerFeeRate === 0.0006 && c.closeTakerFeeRate === 0.0006)).map((c) => `${c.contractName} ${c.openTakerFeeRate}/${c.closeTakerFeeRate}`),
    fee_keys: Object.keys(cl[0] ?? {}).filter((k) => /fee/i.test(k)),
    api_linear_not_on_web: hidden.length, examples: hidden.slice(0, 12),
  });
}

async function webFunding() {
  for (const quote of ['USDT', 'USDC', 'USD']) {
    const r = await get(`${WEB}/common/funding_rate_real_time?symbol=${quote}`);
    const rows = r.json?.data ?? [];
    log('web_funding', {
      quote, status: r.status, ms: Math.round(r.ms), bytes: r.bytes, rows: rows.length, keys: rows[0] && Object.keys(rows[0]),
      interval_hours: tally(rows, (x) => x.capitalFrequency), limits: tally(rows, (x) => `${x.capitalPremiumMin}/${x.capitalPremiumMax}`),
      base_interest: tally(rows, (x) => x.capitalRate), remaining_s: tally(rows, (x) => x.remainingSecond),
      beyond_limit: rows.filter((x) => Math.abs(Number(x.fundingRate)) > Math.abs(Number(x.capitalPremiumMax))).map((x) => `${x.contractName} ${x.fundingRate}`),
      alias_differs: rows.filter((x) => x.contractName !== x.symbolAlias.replace('-', '')).map((x) => `${x.contractName} ${x.symbolAlias}`),
    });
    await sleep(300);
  }
  const k = await post(`${WEB}/common/funding_rate_history`, { symbol: 'KERNEL-USDT', page: 1, rows: 6 });
  log('funding_history_beyond_limit', { rows: (k.json?.data?.records ?? []).map((x) => ({ at: new Date(x.calcTime).toISOString(), rate: x.lastFundingRate, h: x.fundingIntervalHours })) });
}

async function clock() {
  const offs = [];
  for (let i = 0; i < 5; i++) {
    const a = Date.now();
    const r = await get(`${FAPI}/fapi/v1/time`);
    const b = Date.now();
    offs.push({ offset: r.json.serverTime - (a + b) / 2, rtt: b - a });
    await sleep(1000);
  }
  log('clock', { samples: offs, timezone_field: 'see first reply' });
}

async function anchor() {
  const last = {};
  const changes = {};
  const ms = { index: [], web: [] };
  const errs = [];
  let webRows = 0;
  let webBytes = 0;
  const webPrev = new Map();
  const webChanges = { fundingRate: 0, remainingSecond: 0, rows: 0 };
  for (let round = 0; round < 60; round++) {
    const t0 = Date.now();
    const calls = TRACKED.map((c) => get(`${FAPI}/${c.endsWith('-USD') ? 'dapi' : 'fapi'}/v1/index?contractName=${c}`).then((r) => [c, r]));
    calls.push(get(`${WEB}/common/funding_rate_real_time?symbol=USDT`).then((r) => ['web', r]));
    for (const [c, r] of await Promise.all(calls)) {
      if (c === 'web') {
        ms.web.push(r.ms);
        const rows = r.json?.data ?? [];
        webRows = rows.length;
        webBytes = r.bytes;
        for (const x of rows) {
          const p = webPrev.get(x.contractName);
          if (p) {
            webChanges.rows++;
            if (p.fundingRate !== x.fundingRate) webChanges.fundingRate++;
            if (p.remainingSecond !== x.remainingSecond) webChanges.remainingSecond++;
          }
          webPrev.set(x.contractName, x);
        }
        if (round === 0) save('web-funding-usdt.json', r.text);
        continue;
      }
      ms.index.push(r.ms);
      const j = r.json;
      if (!j || j.indexPrice === undefined) { errs.push({ c, status: r.status, body: r.text.slice(0, 120) }); continue; }
      const p = last[c];
      changes[c] ??= { indexPrice: 0, tagPrice: 0, currentFundRate: 0, nextFundRate: 0, remainingSecond: 0, same_cur_next: 0, rounds: 0, rem: [] };
      const ch = changes[c];
      ch.rounds++;
      if (j.currentFundRate === j.nextFundRate) ch.same_cur_next++;
      ch.rem.push(j.remainingSecond);
      if (p) for (const k of ['indexPrice', 'tagPrice', 'currentFundRate', 'nextFundRate', 'remainingSecond']) if (p[k] !== j[k]) ch[k]++;
      if (round === 0) log('index_first', { contract: c, reply: j, premium_ppm: Math.round((j.tagPrice / j.indexPrice - 1) * 1e6) });
      last[c] = j;
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  for (const [c, ch] of Object.entries(changes)) {
    const { rem, ...rest } = ch;
    log('index_changes', { contract: c, ...rest, remainingSecond_first_last: [rem[0], rem[rem.length - 1]] });
  }
  log('anchor_times', { index: stats(ms.index), web: stats(ms.web), web_rows: webRows, web_bytes: webBytes, web_changes_between_rounds: webChanges, errors: errs.slice(0, 5) });
  const cmp = [];
  for (const c of TRACKED.filter((x) => x.endsWith('-USDT'))) {
    const w = webPrev.get(c.slice(2).replace('-', ''));
    cmp.push({ c, index_currentFundRate: last[c]?.currentFundRate, web_fundingRate: w?.fundingRate, index_remaining: last[c]?.remainingSecond, web_remaining: w?.remainingSecond, web_interval: w?.capitalFrequency });
  }
  log('index_vs_web', { cmp });
}

async function survey() {
  const lin = (await get(`${FAPI}/fapi/v1/contracts`)).json;
  const rows = [];
  const t0 = Date.now();
  // Five requests at once, then the rest of the second, keeps the survey at 5 per second whatever the reply time.
  for (let i = 0; i < lin.length; i += 5) {
    const t = Date.now();
    const got = await Promise.all(lin.slice(i, i + 5).map((c) => get(`${FAPI}/fapi/v1/index?contractName=${c.symbol}`).then((r) => ({ c: c.symbol, status: r.status, ms: r.ms, j: r.json }))));
    rows.push(...got);
    const wait = 1000 - (Date.now() - t);
    if (wait > 0) await sleep(wait);
  }
  save('index-survey.json', rows.map((r) => ({ c: r.c, j: r.j })));
  const ok = rows.filter((r) => r.j && r.j.indexPrice !== undefined);
  const prem = ok.map((r) => ({ c: r.c, ppm: r.j.indexPrice ? Math.round((r.j.tagPrice / r.j.indexPrice - 1) * 1e6) : null }));
  const absPrem = prem.filter((p) => p.ppm !== null).map((p) => Math.abs(p.ppm));
  log('survey', {
    contracts: rows.length, seconds: Math.round((Date.now() - t0) / 1000), ok: ok.length, times: stats(rows.map((r) => r.ms)),
    failed: rows.filter((r) => !(r.j && r.j.indexPrice !== undefined)).map((r) => r.c + ' ' + r.status + ' ' + JSON.stringify(r.j)).slice(0, 8),
    index_zero: ok.filter((r) => !r.j.indexPrice).map((r) => r.c), mark_zero: ok.filter((r) => !r.j.tagPrice).map((r) => r.c),
    cur_ne_next: ok.filter((r) => r.j.currentFundRate !== r.j.nextFundRate).length,
    remaining: tally(ok, (r) => Math.round(r.j.remainingSecond / 60) + 'min'),
    abs_premium_ppm: stats(absPrem),
    premium_over_3750ppm: prem.filter((p) => Math.abs(p.ppm) > 3750).slice(0, 12),
    funding_at_clamp: ok.filter((r) => Math.abs(r.j.currentFundRate) >= 0.00375).map((r) => r.c + ' ' + r.j.currentFundRate).slice(0, 12),
  });
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
if (mode === 'main') {
  await host();
  await catalog();
  await book();
  await errors();
  await history();
  await webContracts();
  await webFunding();
  await clock();
} else if (mode === 'anchor') {
  await anchor();
} else if (mode === 'survey') {
  await survey();
} else {
  console.error('unknown mode', mode);
  process.exit(2);
}
log('done', { at: new Date().toISOString() });
