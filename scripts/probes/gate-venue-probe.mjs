// Gate REST probe: host and latency, the CCXT catalog, the anchor bulk calls polled at one hertz, the REST book, error shapes and index baskets.
// Public, unauthenticated, read-only. Every loop keeps at least one second between two requests to the same endpoint.
// Run from server/: node ../scripts/probes/gate-venue-probe.mjs [main|baskets|settlement|decimal]
//   main        host, catalog, anchor poll (about 60 rounds), book, errors, a basket sample, and a price scale check against okx. About 3 minutes.
//   baskets     index_constituents for every active USDT perpetual at one request per second. About 17 minutes, pass crypto or tradfi to halve it.
//   settlement  polls four contracts and the funding history every 5 s from 90 s before the next settlement to 120 s after it.
//   decimal     reads the ETH_USDT REST book with and without the X-Gate-Size-Decimal header. A few seconds.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/gate/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.gateio.ws/api/v4';
const OUT = process.env.PROBE_OUT_DIR;
const ANCHOR_ROUNDS = 60;
const TRACKED = ['BTC_USDT', 'ETH_USDT', 'CHR_USDT', 'INIT_USDT'];
let ccxtIds = new Set(); // USDT settled CCXT market ids, filled by catalog()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function save(name, body) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof body === 'string' ? body : JSON.stringify(body, null, 1));
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(path.startsWith('https://') ? path : API + path, { headers: { accept: 'application/json' } });
  const ttfb = performance.now() - t0;
  const text = await res.text();
  const ms = performance.now() - t0;
  const h = (k) => res.headers.get(k);
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return {
    status: res.status,
    ms: Math.round(ms),
    ttfbMs: Math.round(ttfb),
    bytes: Buffer.byteLength(text),
    encoding: h('content-encoding'),
    serverMs: h('x-in-time') && h('x-out-time') ? (Number(h('x-out-time')) - Number(h('x-in-time'))) / 1000 : null, // microseconds in the headers
    limit: h('x-gate-ratelimit-limit'),
    remain: h('x-gate-ratelimit-requests-remain'),
    reset: h('x-gate-ratelimit-reset-timestamp'),
    retryAfter: h('retry-after'),
    date: h('date'),
    text,
    json,
  };
}

const strip = (r) => { const { text, json, ...rest } = r; return rest; };

// The region comes from Amazon's published ranges, so it says where the address is announced and not where the matching engine runs.
async function host() {
  let prefixes = [];
  try { prefixes = (await (await fetch('https://ip-ranges.amazonaws.com/ip-ranges.json')).json()).prefixes; } catch {}
  const toInt = (ip) => ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
  const regionOf = (ip) => {
    const hits = new Set();
    for (const p of prefixes) {
      const [net, bits] = p.ip_prefix.split('/');
      const size = 2 ** (32 - Number(bits));
      const start = toInt(net);
      if (toInt(ip) >= start && toInt(ip) < start + size) hits.add(p.region);
    }
    return [...hits].join('/') || 'not in AWS ranges';
  };
  for (const name of ['api.gateio.ws', 'fx-api.gateio.ws', 'fx-ws.gateio.ws']) {
    const out = { name };
    try { out.cname = await dns.resolveCname(name); } catch (e) { out.cname = e.code; }
    try { out.a = (await dns.resolve4(name)).map((ip) => `${ip} ${regionOf(ip)}`); } catch (e) { out.a = e.code; }
    log('dns', out);
  }
}

// The first request of the process pays DNS and TLS, and later paths reuse that connection, so their first request is only the first on that path.
// The next five requests show the warm figure.
async function latency() {
  const calls = [
    ['time', '/spot/time'],
    ['contracts_usdt', '/futures/usdt/contracts'],
    ['tickers_usdt', '/futures/usdt/tickers'],
    ['book_btc', '/futures/usdt/order_book?contract=BTC_USDT&limit=20&with_id=true'],
    ['tickers_usdt_fx_api', 'https://fx-api.gateio.ws/api/v4/futures/usdt/tickers'],
  ];
  for (const [id, path] of calls) {
    const runs = [];
    for (let i = 0; i < 6; i++) {
      const r = await get(path);
      runs.push(strip(r));
      if (i === 0) save(`${id}.json`, r.text);
      await sleep(1100);
    }
    const warm = runs.slice(1).map((r) => r.ms).sort((a, b) => a - b);
    log('latency', { id, path, cold: runs[0], warmMin: warm[0], warmMed: warm[2], warmMax: warm[4], bytes: runs[0].bytes, encoding: runs[0].encoding, serverMs: runs.map((r) => r.serverMs) });
  }
  const t = await get('/spot/time');
  const local = Date.now();
  log('clock', { serverTime: t.json?.server_time, localAfterReply: local, offsetMsUpperBound: local - t.json?.server_time, rttMs: t.ms });
}

async function catalog() {
  const ex = new ccxt.gate();
  const t0 = Date.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const swaps = all.filter((m) => m !== undefined && m.type === 'swap' && m.swap === true && m.active !== false);
  const bySettle = {};
  for (const m of swaps) { const k = `${m.settle}:${m.linear ? 'linear' : 'inverse'}`; bySettle[k] = (bySettle[k] ?? 0) + 1; }
  const takers = {};
  for (const m of swaps) takers[m.taker] = (takers[m.taker] ?? 0) + 1;
  const types = {};
  for (const m of all) types[m.type] = (types[m.type] ?? 0) + 1;
  const pairs = {};
  for (const m of swaps) (pairs[`${m.base}|${m.quote}`] ??= []).push(m.id);
  const pick = (m) => m && { id: m.id, symbol: m.symbol, base: m.base, quote: m.quote, settle: m.settle, linear: m.linear, contractSize: m.contractSize, taker: m.taker, maker: m.maker, precision: m.precision, active: m.active, quanto_multiplier: m.info.quanto_multiplier, enable_decimal: m.info.enable_decimal, contract_type: m.info.contract_type };
  log('ccxt', {
    version: ccxt.version, ms: Date.now() - t0, types, activeSwaps: swaps.length, bySettle, takers,
    pairsListedTwice: Object.entries(pairs).filter(([, v]) => v.length > 1),
    idNotName: swaps.filter((m) => m.id !== m.info.name).length,
    nonUnitContractSize: swaps.filter((m) => m.contractSize !== 1).length,
    settleUsd1: all.filter((m) => m.settle === 'USD1').length,
    decimalSize: swaps.filter((m) => m.info.enable_decimal).map((m) => m.id),
    preMarket: swaps.filter((m) => m.info.is_pre_market).map((m) => m.id),
    contractTypes: swaps.reduce((acc, m) => ((acc[m.info.contract_type || 'crypto'] = (acc[m.info.contract_type || 'crypto'] ?? 0) + 1), acc), {}),
    samples: ['BTC_USDT', 'ETH_USDT', 'CHR_USDT', 'INIT_USDT', 'PEPE_USDT', 'BTC_USD'].map((id) => pick(swaps.find((m) => m.id === id))),
    nonAsciiIds: swaps.filter((m) => !/^[\x20-\x7e]*$/.test(m.id)).map((m) => m.id),
  });
  ccxtIds = new Set(swaps.filter((m) => m.settle === 'USDT').map((m) => m.id));

  // The raw listing per settle path, including the one CCXT does not load.
  for (const settle of ['usdt', 'btc', 'usd1']) {
    const r = await get(`/futures/${settle}/contracts`);
    const rows = Array.isArray(r.json) ? r.json : [];
    const count = (k) => rows.reduce((acc, c) => ((acc[c[k]] = (acc[c[k]] ?? 0) + 1), acc), {});
    log('contracts', { settle, ...strip(r), rows: rows.length, status: count('status'), type: count('type'), fundingInterval: count('funding_interval'), nextApply: count('funding_next_apply'), contractType: count('contract_type'), markType: count('mark_type'), inDelisting: rows.filter((c) => c.in_delisting).length, preMarket: rows.filter((c) => c.is_pre_market).map((c) => c.name) });
    await sleep(1100);
  }
}

// Polls the two bulk calls side by side, each at most once a second, and counts how often each tracked number changed.
async function anchor() {
  const series = { tickers: {}, contracts: {} };
  const rtt = { tickers: [], contracts: [] };
  const keyCheck = {};
  const skew = [];

  async function loop(kind, path, pick) {
    for (let i = 0; i < ANCHOR_ROUNDS; i++) {
      const started = Date.now();
      let r;
      try { r = await get(path); } catch (e) { rtt[kind].push({ error: String(e) }); await sleep(1000); continue; }
      const arrived = Date.now();
      rtt[kind].push({ ms: r.ms, ttfbMs: r.ttfbMs, bytes: r.bytes, status: r.status, serverMs: r.serverMs, remain: r.remain });
      if (r.status !== 200 || !Array.isArray(r.json)) { log('anchor_error', { kind, status: r.status, body: r.text.slice(0, 200), retryAfter: r.retryAfter }); }
      else {
        if (i === 0) {
          const keys = new Set(r.json.map((x) => x.contract ?? x.name));
          keyCheck[kind] = { rows: r.json.length, keyField: kind === 'tickers' ? 'contract' : 'name', sample: [...keys].slice(0, 3), notInCcxt: [...keys].filter((k) => !ccxtIds.has(k)), ccxtNotInReply: [...ccxtIds].filter((k) => !keys.has(k)) };
          save(`anchor_${kind}_first.json`, r.text);
        }
        for (const row of r.json) {
          const id = row.contract ?? row.name;
          if (!TRACKED.includes(id)) continue;
          (series[kind][id] ??= []).push({ at: arrived, ...pick(row) });
        }
      }
      await sleep(Math.max(0, 1000 - (Date.now() - started)));
    }
  }

  await Promise.all([
    loop('tickers', '/futures/usdt/tickers', (t) => ({ index: t.index_price, mark: t.mark_price, rate: t.funding_rate, indicative: t.funding_rate_indicative, last: t.last })),
    loop('contracts', '/futures/usdt/contracts', (c) => ({ index: c.index_price, mark: c.mark_price, rate: c.funding_rate, indicative: c.funding_rate_indicative, last: c.last_price, interval: c.funding_interval, next: c.funding_next_apply, limit: c.funding_rate_limit, orderbookId: c.orderbook_id })),
  ]);

  const changes = (rows, k) => rows.slice(1).filter((row, i) => row[k] !== rows[i][k]).length;
  for (const kind of ['tickers', 'contracts']) {
    for (const id of TRACKED) {
      const rows = series[kind][id] ?? [];
      const out = { kind, id, polls: rows.length };
      for (const k of ['index', 'mark', 'rate', 'last', 'next', 'interval', 'orderbookId']) if (rows[0]?.[k] !== undefined) out[`${k}Changes`] = changes(rows, k);
      out.first = rows[0];
      out.last = rows.at(-1);
      out.markEqualsLast = rows.filter((row) => row.mark === row.last).length;
      out.rateEqualsIndicative = rows.filter((row) => row.rate === row.indicative).length;
      log('anchor_changes', out);
    }
    const ms = rtt[kind].filter((x) => x.ms !== undefined).map((x) => x.ms).sort((a, b) => a - b);
    log('anchor_rtt', { kind, n: ms.length, min: ms[0], p50: ms[Math.floor(ms.length / 2)], p90: ms[Math.floor(ms.length * 0.9)], max: ms.at(-1), over1s: ms.filter((x) => x > 1000).length, over2s: ms.filter((x) => x > 2000).length, bytes: rtt[kind][0]?.bytes, statuses: [...new Set(rtt[kind].map((x) => x.status))], remainMin: Math.min(...rtt[kind].map((x) => Number(x.remain)).filter(Number.isFinite)) });
  }

  // How far the contracts listing lags the tickers listing, read on the same contract a few ms apart.
  for (const id of TRACKED) {
    const t = series.tickers[id] ?? [];
    const c = series.contracts[id] ?? [];
    let same = 0;
    for (const row of c) {
      const near = t.reduce((best, x) => (Math.abs(x.at - row.at) < Math.abs((best?.at ?? Infinity) - row.at) ? x : best), null);
      if (near && near.mark === row.mark && near.index === row.index) same++;
    }
    skew.push({ id, contractsPolls: c.length, sameMarkAndIndexAsNearestTicker: same });
  }
  log('anchor_contracts_vs_tickers', { skew });
  log('anchor_keys', keyCheck);
  save('anchor_series.json', series);
}

async function book() {
  for (const id of ['BTC_USDT', 'CHR_USDT']) {
    for (const q of [`limit=20&with_id=true`, `limit=100&with_id=true`, `limit=300&with_id=true`, `limit=1`]) {
      const r = await get(`/futures/usdt/order_book?contract=${id}&${q}`);
      const j = r.json ?? {};
      const bids = j.bids ?? [];
      const asks = j.asks ?? [];
      const desc = bids.every((l, i) => i === 0 || Number(l.p) < Number(bids[i - 1].p));
      const asc = asks.every((l, i) => i === 0 || Number(l.p) > Number(asks[i - 1].p));
      log('rest_book', { id, q, ...strip(r), bidLevels: bids.length, askLevels: asks.length, bidsDescending: desc, asksAscending: asc, sizeTypes: [...new Set([...bids, ...asks].map((l) => typeof l.s))], priceTypes: [...new Set([...bids, ...asks].map((l) => typeof l.p))], id_: j.id, current: j.current, update: j.update, b0: bids[0], a0: asks[0], err: r.status !== 200 ? r.text.slice(0, 200) : undefined });
      if (q.startsWith('limit=20')) save(`book_${id}.json`, r.text);
      await sleep(1100);
    }
  }
  // Two reads 150 ms apart on the same contract, to see whether the reply is cached at an edge.
  const a = await get('/futures/usdt/order_book?contract=BTC_USDT&limit=5&with_id=true');
  await sleep(150);
  const b = await get('/futures/usdt/order_book?contract=BTC_USDT&limit=5&with_id=true');
  log('rest_book_cache', { firstId: a.json?.id, secondId: b.json?.id, firstCurrent: a.json?.current, secondCurrent: b.json?.current, ms: [a.ms, b.ms] });
}

async function errors() {
  const calls = [
    '/futures/usdt/order_book?contract=NOPE_USDT&limit=20',
    '/futures/usdt/tickers?contract=NOPE_USDT',
    '/futures/usdt/contracts/NOPE_USDT',
    '/futures/usdt/order_book?contract=BTC_USDT&limit=1000',
    '/futures/usdc/contracts',
    '/futures/usdt/premium_index',
    '/futures/usdt/index_constituents/OPENAI_USDT',
  ];
  for (const path of calls) {
    const r = await get(path);
    log('error_shape', { path, status: r.status, bytes: r.bytes, body: r.text.slice(0, 240), retryAfter: r.retryAfter, remain: r.remain });
    await sleep(1100);
  }
}

async function funding() {
  const hist = await get('/futures/usdt/funding_rate?contract=BTC_USDT&limit=6');
  log('funding_history', { ...strip(hist), body: hist.json });
  await sleep(1100);
  const prem = await get('/futures/usdt/premium_index?contract=BTC_USDT&limit=3');
  log('premium_index', { ...strip(prem), body: prem.json });
  await sleep(1100);
  for (const id of ['BTC_USDT', 'ETH_USDT', 'CHR_USDT', 'INIT_USDT', 'ONE_USDT', 'NVDA_USDT', 'XAU_USDT']) {
    const r = await get(`/futures/usdt/index_constituents/${id}`);
    log('basket', { id, status: r.status, ms: r.ms, bytes: r.bytes, basket: r.json?.constituents?.map((c) => `${c.exchange}:${c.symbols.join('+')}@${c.weight}`), body: r.status !== 200 ? r.text.slice(0, 200) : undefined });
    await sleep(1100);
  }
  for (const [settle, id] of [['btc', 'BTC_USD'], ['usd1', 'BTC_USD1']]) {
    const r = await get(`/futures/${settle}/index_constituents/${id}`);
    log('basket', { id, settle, status: r.status, basket: r.json?.constituents?.map((c) => `${c.exchange}:${c.symbols.join('+')}@${c.weight}`) });
    await sleep(1100);
  }
}

// Gate's pre-market OPENAI and ANTHROPIC against okx, which the engine scales by 10 in clusterOverrides.ts.
async function priceScale() {
  for (const [gateId, okxId] of [['OPENAI_USDT', 'OPENAI-USDT-SWAP'], ['ANTHROPIC_USDT', 'ANTHROPIC-USDT-SWAP']]) {
    const [g, o] = await Promise.all([get(`/futures/usdt/contracts/${gateId}`), get(`https://www.okx.com/api/v5/market/ticker?instId=${okxId}`)]);
    const gateLast = Number(g.json?.last_price);
    const okxLast = Number(o.json?.data?.[0]?.last);
    log('price_scale', { gateId, gateLast, okxId, okxLast, ratio: +(gateLast / okxLast).toFixed(3), preMarket: g.json?.is_pre_market });
    await sleep(1100);
  }
}

// Flags every basket that is one source, or that contains Gate's own perpetual.
async function baskets(filter) {
  const r = await get('/futures/usdt/contracts');
  const rows = r.json.filter((c) => c.status === 'trading' && !c.is_pre_market);
  const chosen = rows.filter((c) => filter === 'crypto' ? c.contract_type === '' : filter === 'tradfi' ? c.contract_type !== '' : true);
  const summary = { surveyed: 0, failed: [], singleSource: [], gateFuturesInBasket: [], gateOnly: [], sourceCounts: {}, exchanges: {} };
  const all = {};
  for (const c of chosen) {
    await sleep(1000);
    let b;
    try { b = await get(`/futures/usdt/index_constituents/${c.name}`); } catch (e) { summary.failed.push(`${c.name}:${e}`); continue; }
    if (b.status !== 200) { summary.failed.push(`${c.name}:${b.status}:${b.text.slice(0, 80)}`); if (b.status === 429) await sleep(10_000); continue; }
    const cons = b.json.constituents ?? [];
    all[c.name] = cons.map((x) => ({ exchange: x.exchange, symbols: x.symbols, weight: x.weight }));
    summary.surveyed++;
    summary.sourceCounts[cons.length] = (summary.sourceCounts[cons.length] ?? 0) + 1;
    for (const x of cons) summary.exchanges[x.exchange] = (summary.exchanges[x.exchange] ?? 0) + 1;
    if (cons.length <= 1) summary.singleSource.push(`${c.name}:${cons.map((x) => x.exchange).join('+')}`);
    const gatePerp = cons.filter((x) => /^GateFutures$/i.test(x.exchange));
    if (gatePerp.length) summary.gateFuturesInBasket.push(`${c.name}@${gatePerp.map((x) => x.weight).join('+')}`);
    if (cons.length && cons.every((x) => /^Gate/i.test(x.exchange))) summary.gateOnly.push(`${c.name}:${cons.map((x) => `${x.exchange}@${x.weight}`).join('+')}`);
  }
  log('baskets', { filter: filter ?? 'all', candidates: chosen.length, ...summary });
  save(`baskets_${filter ?? 'all'}.json`, all);
}

// Whether the X-Gate-Size-Decimal header, which the API changelog names for decimal sizes, makes the REST book send fractional sizes on a decimal contract.
async function decimal() {
  for (const header of [false, true]) {
    const res = await fetch(`${API}/futures/usdt/order_book?contract=ETH_USDT&limit=100`, { headers: { accept: 'application/json', ...(header ? { 'X-Gate-Size-Decimal': '1' } : {}) } });
    const j = await res.json();
    const levels = [...(j.bids ?? []), ...(j.asks ?? [])];
    log('rest_book_decimal', { header, status: res.status, levels: levels.length, fractional: levels.filter((l) => Number(l.s) % 1 !== 0).length, sizeTypes: [...new Set(levels.map((l) => typeof l.s))], b0: j.bids?.[0] });
    await sleep(1100);
  }
}

// Reads the published rate on both sides of the next settlement, against the rate the history call records for that instant.
async function settlement() {
  const ids = ['BTC_USDT', 'CVC_USDT', 'IOST_USDT', 'CHR_USDT'];
  const nexts = [];
  for (const id of ids) {
    nexts.push((await get(`/futures/usdt/contracts/${id}`)).json.funding_next_apply);
    await sleep(1100);
  }
  const nextSec = Math.min(...nexts);
  const startAt = nextSec * 1000 - 90_000;
  const endAt = nextSec * 1000 + 120_000;
  log('settlement_plan', { nextApply: nextSec, iso: new Date(nextSec * 1000).toISOString(), waitMs: Math.max(0, startAt - Date.now()), nexts });
  if (startAt - Date.now() > 16 * 60_000) { log('settlement_skip', { reason: 'next settlement is more than 16 minutes away' }); return; }
  await sleep(Math.max(0, startAt - Date.now()));
  const rows = [];
  while (Date.now() < endAt) {
    const started = Date.now();
    for (const id of ids) {
      const r = await get(`/futures/usdt/contracts/${id}`);
      const c = r.json ?? {};
      rows.push({ at: new Date().toISOString(), id, rate: c.funding_rate, indicative: c.funding_rate_indicative, next: c.funding_next_apply, interval: c.funding_interval, mark: c.mark_price, index: c.index_price });
      await sleep(1100);
    }
    await sleep(Math.max(0, 5000 - (Date.now() - started)));
  }
  for (const id of ids) {
    const h = await get(`/futures/usdt/funding_rate?contract=${id}&limit=2`);
    const mine = rows.filter((r) => r.id === id);
    const before = mine.filter((r) => Date.parse(r.at) < nextSec * 1000).at(-1);
    const after = mine.find((r) => Date.parse(r.at) > nextSec * 1000 + 3000);
    log('settlement', { id, before, after, history: h.json, rateChangesOverWindow: mine.slice(1).filter((r, i) => r.rate !== mine[i].rate).length });
    await sleep(1100);
  }
  save('settlement_rows.json', rows);
}

const mode = process.argv[2] ?? 'main';
if (mode === 'main') {
  await host();
  await latency();
  await catalog();
  await anchor();
  await book();
  await errors();
  await funding();
  await priceScale();
} else if (mode === 'baskets') {
  await baskets(process.argv[3]);
} else if (mode === 'settlement') {
  await settlement();
} else if (mode === 'decimal') {
  await decimal();
}
process.exit(0);
