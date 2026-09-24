// HIBT REST probe: hosts and latency, the perpetual catalog, fee fields, the anchor calls (index, mark, funding), funding history, REST books, errors, headers and time.
// Public, unauthenticated, read-only. Requests go out one at a time or up to four together, at most about five per second.
// HIBT publishes no rate limit for its perpetual API, so this stays under the 5 to 10 per second its spot API documents for market data.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hibt/rest-probe.mjs [main|poll|funding]
//   main     DNS, CCXT check, catalog calls and their cross-check, contract fields, book and index against Binance, mark per symbol, errors, books, headers, time, spot count. About 50 s.
//            It also reads Binance's public USD-M premium index once, to compare index prices.
//   poll     60 rounds at 1 s of the bulk contracts call and, in parallel, the mark of three contracts: reply time, how often each number changes, mark against index. About 65 s.
//   funding  the funding history of four contracts: row spacing, distinct rates, and whether settled rates differ from the 5 minute rows. About 10 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/hibt/rest.md and fees.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const FAPI = 'https://fapi.hibt0.com/open-api';
const SPOT = 'https://api.hibt0.com/user-open-api';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init) {
  const t0 = performance.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, ms, bytes: text.length, text, json, headers: res.headers };
}

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (xs) => ({ n: xs.length, min: Math.min(...xs), median: pct(xs, 50), p90: pct(xs, 90), max: Math.max(...xs) });

async function main() {
  for (const host of ['hibt.com', 'fapi.hibt0.com', 'api.hibt0.com', 'apidoc.hibt.co']) {
    const a = await dns.resolve4(host).catch((e) => [e.code]);
    log('dns', { host, a });
  }

  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, hibtLike: ccxt.exchanges.filter((x) => /hibt|hbt/i.test(x)) });

  const cold = await get(`${FAPI}/v2/server/time`);
  const warm = [];
  for (let i = 0; i < 10; i++) warm.push((await get(`${FAPI}/v2/server/time`)).ms);
  log('latency', { url: '/v2/server/time', coldMs: cold.ms, warm: stats(warm), cfRay: cold.headers.get('cf-ray') });

  const headerNames = [...cold.headers.keys()];
  log('headers', { names: headerNames, rateLimitLike: headerNames.filter((h) => /limit|retry|remaining/i.test(h)) });

  // Clock offset from the midpoint of a request.
  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${FAPI}/v2/server/time`);
    const t1 = Date.now();
    offsets.push(r.json.data.serverTime - (t0 + t1) / 2);
  }
  log('clock', { offsetsMs: offsets.map(Math.round) });

  const symbols = await get(`${FAPI}/v2/market/symbols`);
  const contracts = await get(`${FAPI}/v2/market/contracts`);
  const tickers = await get(`${FAPI}/v2/market/tickers`);
  const specs = await get(`${FAPI}/v2/market/contractSpecifications`);
  const prices = await get(`${FAPI}/v2/market/ticker/price`);
  keep('symbols.json', symbols.text);
  keep('contracts.json', contracts.text);
  keep('tickers.json', tickers.text);
  for (const [name, r] of Object.entries({ symbols, contracts, tickers, specs, prices })) {
    log('catalog_call', { name, status: r.status, ms: r.ms, bytes: r.bytes, rows: r.json?.data?.length });
  }

  const sym = symbols.json.data;
  const con = contracts.json.data;
  const tick = tickers.json.data;
  const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  const conIds = new Set(con.map((c) => c.ticker_id));
  const symIds = new Set(sym.map((s) => s.symbol));
  const tickIds = new Set(tick.map((t) => t.symbol));
  log('catalog', {
    symbols: sym.length,
    supportTrade: count(sym, (s) => s.supportTrade),
    notTrading: sym.filter((s) => !s.supportTrade).map((s) => s.symbol),
    symbolsNotInContracts: [...symIds].filter((x) => !conIds.has(x)),
    contractsNotInTickers: [...conIds].filter((x) => !tickIds.has(x)),
    contracts: con.length,
    quote: count(con, (c) => c.quote_currency),
    productType: count(con, (c) => c.product_type),
    contractType: count(con, (c) => c.contract_type),
    faceValueCurrency: count(con, (c) => c.contract_price_currency),
    noUnderscore: con.filter((c) => !c.ticker_id.includes('_')).map((c) => c.ticker_id),
    idNotBaseQuote: con.filter((c) => c.ticker_id !== `${c.base_currency}_${c.quote_currency}`.toLowerCase()).length,
    faceValueEqualsLast: con.filter((c) => c.contract_price === c.last_price).length,
    lastZero: con.filter((c) => Number(c.last_price) === 0).map((c) => c.ticker_id),
    expiry: count(con, (c) => String(c.expiry_timestamp)),
    nextFunding: count(con, (c) => String(c.next_funding_rate_timestamp)),
    rateEqualsNext: con.filter((c) => c.funding_rate === c.next_funding_rate).length,
    rates: count(con, (c) => c.funding_rate),
  });
  log('fees_in_catalog', { maker: count(con, (c) => c.maker_fee), taker: count(con, (c) => c.taker_fee), makerOdd: con.filter((c) => c.maker_fee !== '0.0003').map((c) => c.ticker_id) });
  log('catalog_sample', { contract: con.find((c) => c.ticker_id === 'btc_usdt'), gold: con.find((c) => c.ticker_id === 'gold'), symbol: sym.find((s) => s.symbol === 'btc_usdt') });
  log('volume_vs_oi', {
    rows: con
      .filter((c) => ['btc_usdt', 'eth_usdt', 'sol_usdt', 'gold', 'unitree_usdt'].includes(c.ticker_id))
      .map((c) => ({ id: c.ticker_id, usdVolume24h: Math.round(Number(c.USD_volume)), openInterestUsd: Math.round(Number(c.open_interest_usd)) })),
  });
  const zeroOi = con.filter((c) => Number(c.open_interest) === 0).length;
  log('open_interest', { zeroOiTopVolume: con.filter((c) => Number(c.open_interest) === 0).sort((a, b) => Number(b.USD_volume) - Number(a.USD_volume)).slice(0, 5).map((c) => [c.ticker_id, Math.round(Number(c.USD_volume))]), zeroOi, totalUsdVolume: Math.round(con.reduce((s, c) => s + Number(c.USD_volume || 0), 0)), totalOiUsd: Math.round(con.reduce((s, c) => s + Number(c.open_interest_usd || 0), 0)) });

  // Every contract's touch against its own index, from the bulk book call and the bulk contracts call sent together.
  const [bulkBook, bulkCon] = await Promise.all([get(`${FAPI}/v2/market/orderBook?depth=5`), get(`${FAPI}/v2/market/contracts`)]);
  const idxOf = new Map(bulkCon.json.data.map((c) => [c.ticker_id, Number(c.index_price)]));
  const midPpm = [];
  const far = [];
  for (const row of bulkBook.json.data) {
    const bid = Number(row.bids?.[0]?.[0]);
    const ask = Number(row.asks?.[0]?.[0]);
    const idx = idxOf.get(row.ticker_id);
    if (!(bid > 0 && ask > 0 && idx > 0)) continue;
    const ppm = Math.round((((bid + ask) / 2 - idx) / idx) * 1e6);
    midPpm.push(Math.abs(ppm));
    if (Math.abs(ppm) > 1000) far.push([row.ticker_id, ppm]);
  }
  const thin = bulkBook.json.data.filter((r) => (r.bids?.length ?? 0) <= 1 || (r.asks?.length ?? 0) <= 1).map((r) => `${r.ticker_id} ${r.bids?.length}/${r.asks?.length}`);
  log('bulk_book_shape', { thinBooks: thin, distinctTimestamps: new Set(bulkBook.json.data.map((r) => r.timestamp)).size });
  log('book_vs_index', { status: bulkBook.status, ms: bulkBook.ms, bytes: bulkBook.bytes, rows: bulkBook.json.data.length, absMidMinusIndexPpm: stats(midPpm), within1ppm: midPpm.filter((x) => x <= 1).length, over1000ppm: far });

  // One read of the Binance USD-M index beside the HIBT index, sent together.
  const [bn, hb] = await Promise.all([get('https://fapi.binance.com/fapi/v1/premiumIndex'), get(`${FAPI}/v2/market/contracts`)]);
  const bnIdx = new Map((bn.json ?? []).map((x) => [x.symbol, Number(x.indexPrice)]));
  const vsBinance = [];
  for (const c of hb.json.data) {
    const b = bnIdx.get(`${c.base_currency}USDT`);
    if (b > 0 && Number(c.index_price) > 0) vsBinance.push([c.ticker_id, Math.round(((Number(c.index_price) - b) / b) * 1e6)]);
  }
  log('index_vs_binance', {
    binanceStatus: bn.status,
    matched: vsBinance.length,
    btc: vsBinance.find((x) => x[0] === 'btc_usdt'),
    eth: vsBinance.find((x) => x[0] === 'eth_usdt'),
    absPpm: stats(vsBinance.map((x) => Math.abs(x[1]))),
    over1000ppm: vsBinance.filter((x) => Math.abs(x[1]) > 1000),
  });

  // Mark: documented as optional symbol, bulk refused on the wire, so one call per contract.
  const bulkMark = await get(`${FAPI}/v2/market/index`);
  log('mark_bulk', { status: bulkMark.status, body: bulkMark.text.slice(0, 120) });
  const markMs = [];
  let markRows = 0;
  let markZero = [];
  let markEqIndex = 0;
  const markVsIndex = [];
  for (const c of con) {
    const r = await get(`${FAPI}/v2/market/index?symbol=${c.ticker_id}`);
    markMs.push(r.ms);
    const row = r.json?.data?.[0];
    if (!row) {
      log('mark_missing', { id: c.ticker_id, status: r.status, body: r.text.slice(0, 120) });
    } else {
      markRows++;
      const mark = Number(row.marketPrice);
      const index = Number(c.index_price);
      if (mark === 0) markZero.push(c.ticker_id);
      if (mark === index) markEqIndex++;
      if (index > 0 && mark > 0) markVsIndex.push(Math.round(((mark - index) / index) * 1e6));
    }
    await sleep(200);
  }
  log('mark_per_symbol', { calls: con.length, rows: markRows, ms: stats(markMs), markZero, markEqualsIndexAtCatalogTime: markEqIndex, markMinusIndexPpm: stats(markVsIndex) });

  // Books.
  for (const limit of [5, 20, 100, 200, 500]) {
    const r = await get(`${FAPI}/v2/market/depth?symbol=btc_usdt&limit=${limit}`);
    const d = r.json?.data;
    const bid = d?.bid ?? [];
    const ask = d?.ask ?? [];
    log('depth', {
      limit,
      status: r.status,
      ms: r.ms,
      bids: bid.length,
      asks: ask.length,
      bidsDesc: bid.every((l, i) => i === 0 || Number(l[0]) < Number(bid[i - 1][0])),
      asksAsc: ask.every((l, i) => i === 0 || Number(l[0]) > Number(ask[i - 1][0])),
      top: [bid[0], ask[0]],
      body: d ? undefined : r.text.slice(0, 120),
    });
    await sleep(200);
  }
  for (const q of ['depth=100&symbol=btc_usdt', 'depth=5', 'symbol=btc_usdt']) {
    const r = await get(`${FAPI}/v2/market/orderBook?${q}`);
    const rows = r.json?.data ?? [];
    log('orderBook', { q, status: r.status, ms: r.ms, rows: rows.length, levels: rows.slice(0, 2).map((x) => [x.ticker_id, x.bids?.length, x.asks?.length, x.timestamp]) });
    await sleep(200);
  }
  const quiet = con.filter((c) => Number(c.USD_volume) > 0).sort((a, b) => Number(a.USD_volume) - Number(b.USD_volume))[0];
  const qd = await get(`${FAPI}/v2/market/depth?symbol=${quiet.ticker_id}&limit=20`);
  log('depth_quiet', { id: quiet.ticker_id, usdVolume: quiet.USD_volume, bids: qd.json?.data?.bid?.length, asks: qd.json?.data?.ask?.length, top: [qd.json?.data?.bid?.[0], qd.json?.data?.ask?.[0]] });
  for (const id of ['crude', 'silver']) {
    const r = await get(`${FAPI}/v2/market/depth?symbol=${id}&limit=20`);
    log('depth_lastzero', { id, status: r.status, bids: r.json?.data?.bid?.length, asks: r.json?.data?.ask?.length, body: r.text.slice(0, 160) });
    await sleep(200);
  }

  // Errors.
  const errs = [
    '/v2/market/depth?symbol=nope_usdt',
    '/v2/market/depth?symbol=BTC_USDT',
    '/v2/market/depth?symbol=btc_usdt&limit=30',
    '/v2/market/index?symbol=nope_usdt',
    '/v2/market/fundingRate?symbol=btc_usdt&limit=5',
    '/v2/market/fundingRate',
    '/v2/market/nope',
    '/v2/market/tickers?symbol=nope_usdt',
  ];
  for (const p of errs) {
    const r = await get(`${FAPI}${p}`);
    log('error', { path: p, status: r.status, body: r.text.slice(0, 160) });
    await sleep(200);
  }

  // Spot, for the coverage matrix only.
  const spot = await get(`${SPOT}/v1/common/symbols`);
  const sd = spot.json?.data ?? [];
  log('spot', { status: spot.status, rows: sd.length, enable: count(sd, (s) => s.enable), quotes: count(sd, (s) => s.baseSymbol) });
}

async function poll() {
  const marks = ['btc_usdt', 'eth_usdt', 'unitree_usdt'];
  const prev = new Map();
  const changes = {};
  const ms = [];
  const markMs = [];
  const markPrev = new Map();
  const markChanges = {};
  const markEq = {};
  let over1s = 0;
  const nextTs = new Set();
  for (let i = 0; i < 60; i++) {
    const start = Date.now();
    // The contracts call and the three marks go out together, so a mark can be compared with the index of the same instant.
    const [r, ...ms3] = await Promise.all([get(`${FAPI}/v2/market/contracts`), ...marks.map((id) => get(`${FAPI}/v2/market/index?symbol=${id}`))]);
    ms.push(r.ms);
    if (r.ms > 1000) over1s++;
    for (const c of r.json?.data ?? []) {
      nextTs.add(c.next_funding_rate_timestamp);
      const p = prev.get(c.ticker_id);
      const ch = (changes[c.ticker_id] ??= { index: 0, rate: 0, last: 0, bid: 0 });
      if (p) {
        if (p.index_price !== c.index_price) ch.index++;
        if (p.funding_rate !== c.funding_rate) ch.rate++;
        if (p.last_price !== c.last_price) ch.last++;
        if (p.bid !== c.bid) ch.bid++;
      }
      prev.set(c.ticker_id, c);
    }
    marks.forEach((id, k) => {
      const m = ms3[k];
      markMs.push(m.ms);
      const v = m.json?.data?.[0]?.marketPrice;
      if (markPrev.has(id) && markPrev.get(id) !== v) markChanges[id] = (markChanges[id] ?? 0) + 1;
      markPrev.set(id, v);
      const idx = r.json?.data?.find((c) => c.ticker_id === id)?.index_price;
      const e = (markEq[id] ??= { equal: 0, differ: 0, ppm: [] });
      if (Number(v) === Number(idx)) e.equal++;
      else {
        e.differ++;
        e.ppm.push(Math.round(((Number(v) - Number(idx)) / Number(idx)) * 1e6));
      }
    });
    if (i === 0) log('poll_first', { status: r.status, bytes: r.bytes, rows: r.json?.data?.length });
    const wait = 1000 - (Date.now() - start);
    if (wait > 0) await sleep(wait);
  }
  const pick = (id) => ({ id, ...changes[id], mark: markChanges[id] ?? 0 });
  const all = Object.values(changes);
  log('poll', {
    rounds: 60,
    contractsMs: stats(ms),
    over1s,
    markMs: stats(markMs),
    nextFundingValues: [...nextTs],
    sample: ['btc_usdt', 'eth_usdt', 'unitree_usdt', 'gold', 'crude'].map(pick),
    indexChangedEver: all.filter((c) => c.index > 0).length,
    indexChangesMedian: pct(all.map((c) => c.index), 50),
    rateChangedEver: all.filter((c) => c.rate > 0).length,
    contracts: all.length,
    markVsIndexSameRound: Object.fromEntries(Object.entries(markEq).map(([id, e]) => [id, { equal: e.equal, differ: e.differ, differPpm: stats(e.ppm) }])),
  });
}

async function funding() {
  for (const id of ['btc_usdt', 'eth_usdt', 'ltc_usdt', 'gold']) {
    const r = await get(`${FAPI}/v2/market/fundingRate?symbol=${id}`);
    const rows = r.json?.data ?? [];
    const times = rows.map((x) => x.time);
    const gaps = times.slice(1).map((t, i) => Math.round((times[i] - t) / 1000));
    const rates = rows.reduce((m, x) => ((m[x.rate] = (m[x.rate] ?? 0) + 1), m), {});
    const atSettle = rows.filter((x) => new Date(x.time).getUTCMinutes() === 0 && [0, 8, 16].includes(new Date(x.time).getUTCHours()));
    log('funding_history', {
      id,
      status: r.status,
      rows: rows.length,
      newest: rows[0] && new Date(rows[0].time).toISOString(),
      oldest: rows.at(-1) && new Date(rows.at(-1).time).toISOString(),
      gapSeconds: gaps.length ? { min: Math.min(...gaps), median: pct(gaps, 50), max: Math.max(...gaps) } : null,
      rates,
      rowsAtSettlementMinute: atSettle.length,
    });
    // Older window: does the history go back further with a start time?
    const end = Date.now() - 2 * 86400000;
    const r2 = await get(`${FAPI}/v2/market/fundingRate?symbol=${id}&startTime=${end - 86400000}&endTime=${end}&limit=1000`);
    const rows2 = r2.json?.data ?? [];
    const rates2 = rows2.reduce((m, x) => ((m[x.rate] = (m[x.rate] ?? 0) + 1), m), {});
    log('funding_history_window', { id, status: r2.status, rows: rows2.length, newest: rows2[0] && new Date(rows2[0].time).toISOString(), oldest: rows2.at(-1) && new Date(rows2.at(-1).time).toISOString(), rates: rates2 });
    await sleep(300);
  }
}

const mode = process.argv[2] ?? 'main';
log('start', { mode, at: new Date().toISOString() });
await { main, poll, funding }[mode]();
log('end', { at: new Date().toISOString() });
