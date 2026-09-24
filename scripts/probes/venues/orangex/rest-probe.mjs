// OrangeX public REST probe: host and latency, the perpetual catalog and whether its ids agree across calls, the bulk anchor calls and a one second poll of them, the REST book, error shapes and the server clock.
// Public, unauthenticated, read-only.
// No REST limit is published, so the probe stays at or under three requests a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/orangex/rest-probe.mjs [all|catalog|anchor|book|errors|time|history]
//   catalog  DNS, cold and warm request time, every kind in get_instruments, fees and funding rows against the catalog, a name list of equity and pre-IPO contracts, and the perpetual ids against tickers, cmc_contracts and get_all_capital_rate. About 10 s.
//   anchor   tickers, cmc_contracts and get_all_capital_rate once a second for 60 s: size, time, how often each number changes, mark against the book. About 70 s.
//   book     get_order_book at several depths: level order, level count, version, caching, size unit. About 5 s.
//   errors   unknown instrument, unknown method, missing parameter, calls the docs do not list, and a JSON-RPC POST body. About 8 s.
//   time     usIn and usOut against the local clock on five requests. About 3 s.
//   history  the settled funding history the website reads, from the undocumented POST www.orangex.com/api/v2/public/get_funding_rate_history, for one 8 h, one 4 h and one 1 h contract. About 3 s.
// Set PROBE_OUT_DIR to keep the raw replies. Recorded in docs/profiles/orangex/rest.md.
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HOST = 'api.orangex.com';
const API = `https://${HOST}/api/v1/public`;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const iso = (ms) => new Date(Number(ms)).toISOString();

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path, init) {
  const t0 = performance.now();
  const res = await fetch(`${API}/${path}`, init);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { unparsed: text.slice(0, 200) };
  }
  return { status: res.status, ms, bytes: text.length, body, text, headers: res.headers };
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s[s.length - 1] };
}

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = typeof key === 'function' ? key(r) : r[key];
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

async function catalog() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });

  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('tickers?instrument_name=BTC-USDT-PERPETUAL');
    times.push(r.ms);
    await sleep(300);
  }
  log('latency_small_call', { cold: times[0], warm: stats(times.slice(1)) });

  const all = await get('get_instruments');
  keep('instruments_all.json', all.text);
  const rows = all.body.result;
  log('instruments_no_param', {
    status: all.status,
    bytes: all.bytes,
    ms: all.ms,
    rows: rows.length,
    byKindActiveSettle: countBy(rows, (r) => `${r.kind}|active=${r.is_active}|settle=${r.base_currency}`),
  });

  const perp = await get('get_instruments?currency=PERPETUAL');
  keep('instruments_perpetual.json', perp.text);
  const p = perp.body.result;
  const now = Date.now();
  const future = p.filter((r) => Number(r.creation_timestamp) > now);
  log('instruments_perpetual', {
    status: perp.status,
    bytes: perp.bytes,
    ms: perp.ms,
    rows: p.length,
    kinds: countBy(p, 'kind'),
    active: countBy(p, 'is_active'),
    settle: countBy(p, 'base_currency'),
    nameShape: countBy(p, (r) => (/^[A-Z0-9]+-USDT-PERPETUAL$/.test(r.instrument_name) ? 'COIN-USDT-PERPETUAL' : r.instrument_name)),
    showNameIsCoinUSDT: p.filter((r) => r.show_name === `${r.quote_currency}USDT`).length,
    contractSizeField: p.filter((r) => 'contract_size' in r).length,
    takerMaker: countBy(p, (r) => `${r.taker_commission}/${r.maker_commission}`),
    leverage: countBy(p, 'leverage'),
    obDepth: countBy(p, 'obDepth'),
    newListing: countBy(p, 'newListing'),
    closeOnlyNonZero: p.filter((r) => r.close_only_limit_value !== '0' || r.close_only_limit_qty !== '0').length,
    createdInFuture: future.map((r) => `${r.instrument_name} ${iso(r.creation_timestamp)}`),
    scaledNames: p.filter((r) => /^1[0-9]{3,}|^1M/.test(r.quote_currency)).map((r) => r.instrument_name),
    btc: p.find((r) => r.instrument_name === 'BTC-USDT-PERPETUAL'),
  });

  for (const cur of ['SPOT', 'SANDBOX']) {
    const r = await get(`get_instruments?currency=${cur}`);
    log('instruments_other', { currency: cur, status: r.status, rows: r.body.result?.length, kinds: countBy(r.body.result ?? [], 'kind'), error: r.body.error });
  }

  const tick = await get('tickers?currency=PERPETUAL');
  const cmc = await get('cmc_contracts');
  const cap = await get('get_all_capital_rate');
  const cg = await get('coin_gecko_contracts');
  log('bulk_calls_once', {
    tickers: { bytes: tick.bytes, ms: tick.ms },
    cmc: { bytes: cmc.bytes, ms: cmc.ms },
    cap: { bytes: cap.bytes, ms: cap.ms },
    coinGecko: { bytes: cg.bytes, ms: cg.ms, rows: cg.body.result?.length, keys: Object.keys(cg.body.result?.[0] ?? {}) },
  });
  const ids = new Set(p.map((r) => r.instrument_name));
  const byId = new Map(p.map((r) => [r.instrument_name, r]));
  const cmcRows = cmc.body.result.filter((c) => byId.has(c.ticker_id));
  log('cmc_fees_against_catalog', {
    rows: cmcRows.length,
    takerEqual: cmcRows.filter((c) => Number(c.taker_fee) === Number(byId.get(c.ticker_id).taker_commission)).length,
    makerEqual: cmcRows.filter((c) => Number(c.maker_fee) === Number(byId.get(c.ticker_id).maker_commission)).length,
  });
  // A name list, since the catalog carries no flag for equity, ETF, commodity or pre-IPO contracts.
  const tradfi = ['OPENAI', 'ANTHROPIC', 'SPACEX', 'TSLA', 'AAPL', 'NVDA', 'MSTR', 'COIN', 'GOOGL', 'AMZN', 'META', 'MSFT', 'GS', 'JPM', 'QCOM', 'CSCO', 'DIS', 'EWJ', 'ARM', 'AAOI', 'SPY', 'QQQ', 'XAU', 'XAUT', 'XAG', 'PAXG', 'CRCL', 'HOOD', 'INTC', 'AMD', 'NFLX', 'BABA', 'PLTR', 'ORCL', 'SNDK', 'WDC', 'MU', 'TSM', 'IBM', 'BA', 'WMT', 'KO', 'GLD', 'SLV', 'TLT', 'IWM', 'DIA', 'EWY', 'EWZ', 'FXI', 'CL', 'NG', 'USO', 'UNG'];
  const coins = new Set(p.map((r) => r.quote_currency));
  const found = tradfi.filter((c) => coins.has(c));
  log('tradfi_names', { found: found.length, names: found.join(' '), deniedPairsListed: ['BB', 'ON', 'QNT', 'ONE'].filter((c) => coins.has(c)) });
  const capRows = cap.body.result;
  log('cap_catalog_rows', {
    beyondCap: capRows.filter((x) => Math.abs(Number(x.capitalRate)) > 0.0075).map((x) => `${x.instrumentName} ${x.capitalRate} ${iso(x.currentTime)} inCatalog=${ids.has(x.instrumentName)}`),
    offGridStarts: capRows.filter((x) => ids.has(x.instrumentName) && (Number(x.endTime) - Number(x.startTime)) === 28_800_000 && new Date(Number(x.startTime)).getUTCHours() % 8 !== 0).map((x) => `${x.instrumentName} ${iso(x.startTime)} to ${iso(x.endTime)}`),
    intervalHours: countBy(capRows.filter((x) => ids.has(x.instrumentName)), (x) => (Number(x.endTime) - Number(x.startTime)) / 3_600_000),
  });
  for (const [name, r, key] of [
    ['tickers?currency=PERPETUAL', tick, 'instrument_name'],
    ['cmc_contracts', cmc, 'ticker_id'],
    ['get_all_capital_rate', cap, 'instrumentName'],
  ]) {
    const got = new Set(r.body.result.map((x) => x[key]));
    log('ids_against_catalog', {
      call: name,
      rows: r.body.result.length,
      inCatalog: [...got].filter((x) => ids.has(x)).length,
      notInCatalog: [...got].filter((x) => !ids.has(x)).length,
      catalogMissing: [...ids].filter((x) => !got.has(x)),
    });
  }
}

async function anchor() {
  const calls = [
    ['tickers', 'tickers?currency=PERPETUAL'],
    ['cmc', 'cmc_contracts'],
    ['cap', 'get_all_capital_rate'],
  ];
  const timing = { tickers: [], cmc: [], cap: [] };
  const bytes = { tickers: 0, cmc: 0, cap: 0 };
  const series = new Map(); // instrument to arrays of readings
  const at = (id) => {
    if (!series.has(id)) series.set(id, { mark: [], und: [], idx: [], rate: [], cmcRate: [], tickTs: [], capNow: [] });
    return series.get(id);
  };
  const markVsMedian = { rows: 0, equal: 0, last: 0 };
  let lastTick;
  let lastCmc;
  let lastCap;
  const polls = 60;
  const start = Date.now();
  for (let i = 0; i < polls; i++) {
    const due = start + i * 1000;
    if (Date.now() < due) await sleep(due - Date.now());
    for (const [k, path] of calls) {
      const r = await get(path);
      timing[k].push(r.ms);
      bytes[k] = r.bytes;
      if (!Array.isArray(r.body.result)) {
        log('anchor_error', { call: k, status: r.status, body: r.text.slice(0, 200) });
        continue;
      }
      if (k === 'tickers') {
        lastTick = r.body.result;
        for (const x of r.body.result) {
          const med = [Number(x.best_bid_price), Number(x.best_ask_price), Number(x.last_price)].sort((a, b) => a - b)[1];
          markVsMedian.rows++;
          if (Number(x.mark_price) === med) markVsMedian.equal++;
          if (Number(x.mark_price) === Number(x.last_price)) markVsMedian.last++;
          const s = at(x.instrument_name);
          s.mark.push(x.mark_price);
          s.und.push(x.underlying_price);
          s.tickTs.push(Number(x.timestamp));
        }
      } else if (k === 'cmc') {
        lastCmc = r.body.result;
        for (const x of r.body.result) {
          const s = at(x.ticker_id);
          s.idx.push(x.index_price);
          s.cmcRate.push(x.funding_rate);
        }
      } else {
        lastCap = r.body.result;
        for (const x of r.body.result) {
          const s = at(x.instrumentName);
          s.rate.push(x.capitalRate);
          s.capNow.push(x.currentTime);
        }
      }
    }
  }
  for (const k of Object.keys(timing)) log('anchor_call', { call: k, bytes: bytes[k], ms: stats(timing[k]) });

  log('mark_against_median_of_bid_ask_last', markVsMedian);
  const changes = (arr) => arr.reduce((n, v, i) => n + (i > 0 && v !== arr[i - 1] ? 1 : 0), 0);
  const live = [...series.entries()].filter(([, s]) => s.mark.length > 0 && s.idx.length > 0);
  const per = (field) => stats(live.map(([, s]) => changes(s[field])));
  log('anchor_changes_over_60_polls', {
    instruments: live.length,
    mark: per('mark'),
    underlying: per('und'),
    cmcIndex: per('idx'),
    capRate: per('rate'),
    cmcRate: per('cmcRate'),
    capCurrentTime: per('capNow'),
  });
  for (const id of ['BTC-USDT-PERPETUAL', 'ETH-USDT-PERPETUAL', 'SOL-USDT-PERPETUAL', 'CHR-USDT-PERPETUAL', 'TSLA-USDT-PERPETUAL']) {
    const s = series.get(id);
    if (!s) continue;
    log('anchor_one', {
      id,
      markChanges: changes(s.mark),
      underlyingChanges: changes(s.und),
      cmcIndexChanges: changes(s.idx),
      capRateChanges: changes(s.rate),
      capRateValues: [...new Set(s.rate)].slice(0, 6),
      capCurrentTimes: [...new Set(s.capNow)].map(iso),
      tickerTsAgeAtEnd: Date.now() - s.tickTs[s.tickTs.length - 1],
      markOverUnderlyingPpm: stats(s.mark.map((m, i) => Math.round((Number(m) / Number(s.und[i]) - 1) * 1e6))),
    });
  }

  // The last reading of each call, compared field by field.
  const cmcBy = new Map(lastCmc.map((x) => [x.ticker_id, x]));
  const capBy = new Map(lastCap.map((x) => [x.instrumentName, x]));
  let undEqIdx = 0;
  let markEqLast = 0;
  let markInside = 0;
  let markEqBidOrAsk = 0;
  let rateEq = 0;
  let nextEqEnd = 0;
  const prem = [];
  const tsAge = [];
  const intervals = {};
  const now = Date.now();
  for (const t of lastTick) {
    const c = cmcBy.get(t.instrument_name);
    const cp = capBy.get(t.instrument_name);
    const mark = Number(t.mark_price);
    if (c) {
      if (Number(c.index_price) === Number(t.underlying_price)) undEqIdx++;
      prem.push({ id: t.instrument_name, ppm: Math.round((mark / Number(c.index_price) - 1) * 1e6) });
    }
    if (mark === Number(t.last_price)) markEqLast++;
    if (mark === Number(t.best_bid_price) || mark === Number(t.best_ask_price)) markEqBidOrAsk++;
    if (mark >= Number(t.best_bid_price) && mark <= Number(t.best_ask_price)) markInside++;
    tsAge.push(now - Number(t.timestamp));
    if (c && cp) {
      if (Number(c.funding_rate) === Number(cp.capitalRate)) rateEq++;
      if (Number(c.next_funding_rate_timestamp) === Number(cp.endTime)) nextEqEnd++;
      const h = (Number(cp.endTime) - Number(cp.startTime)) / 3_600_000;
      intervals[h] = (intervals[h] ?? 0) + 1;
    }
  }
  prem.sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  log('anchor_last_poll_compare', {
    tickers: lastTick.length,
    nonPositive: {
      mark: lastTick.filter((t) => !(Number(t.mark_price) > 0)).length,
      underlying: lastTick.filter((t) => !(Number(t.underlying_price) > 0)).length,
      cmcIndex: lastCmc.filter((c) => !(Number(c.index_price) > 0)).length,
    },
    underlyingEqualsCmcIndex: undEqIdx,
    markEqualsLast: markEqLast,
    markEqualsBidOrAsk: markEqBidOrAsk,
    markInsideTouch: markInside,
    markOverCmcIndexPpm: stats(prem.map((x) => Math.abs(x.ppm))),
    over10000ppm: prem.filter((x) => Math.abs(x.ppm) > 10_000).length,
    largest: prem.slice(0, 8),
    tickerTimestampAgeMs: stats(tsAge),
    cmcRateEqualsCapRate: rateEq,
    cmcNextEqualsCapEnd: nextEqEnd,
    capIntervalHours: intervals,
  });

  const rates = lastCap.map((x) => Number(x.capitalRate));
  const liveIds = new Set(lastTick.map((x) => x.instrument_name));
  const liveCap = lastCap.filter((x) => liveIds.has(x.instrumentName));
  log('cap_rows', {
    rows: lastCap.length,
    live: liveCap.length,
    stale: lastCap.length - liveCap.length,
    staleCurrentTimeRange: [iso(Math.min(...lastCap.filter((x) => !liveIds.has(x.instrumentName)).map((x) => Number(x.currentTime)))), iso(Math.max(...lastCap.filter((x) => !liveIds.has(x.instrumentName)).map((x) => Number(x.currentTime))))],
    rateRangeAll: [Math.min(...rates), Math.max(...rates)],
    liveRateRange: [Math.min(...liveCap.map((x) => Number(x.capitalRate))), Math.max(...liveCap.map((x) => Number(x.capitalRate)))],
    liveEndTimes: countBy(liveCap, (x) => iso(x.endTime)),
    liveStartTimes: countBy(liveCap, (x) => iso(x.startTime)),
    isPush: countBy(liveCap, 'isPush'),
    notLiveButCurrent: lastCap.filter((x) => !liveIds.has(x.instrumentName) && Number(x.currentTime) > Date.now() - 86_400_000).map((x) => `${x.instrumentName} ${iso(x.currentTime)}`),
  });

  const one = await get('get_funding_rate?instrument_name=BTC-USDT-PERPETUAL');
  log('get_funding_rate_one', { status: one.status, ms: one.ms, result: one.body.result, capRow: capBy.get('BTC-USDT-PERPETUAL') });
  if (OUT) {
    keep('tickers_last.json', JSON.stringify(lastTick));
    keep('cmc_last.json', JSON.stringify(lastCmc));
    keep('cap_last.json', JSON.stringify(lastCap));
  }
}

async function book() {
  const t = (await get('tickers?instrument_name=BTC-USDT-PERPETUAL')).body.result[0];
  for (const [id, depth] of [
    ['BTC-USDT-PERPETUAL', 20],
    ['BTC-USDT-PERPETUAL', 100],
    ['BTC-USDT-PERPETUAL', 500],
    ['BTC-USDT-PERPETUAL', 0],
    ['BTC-USDT-PERPETUAL', undefined],
    ['CHR-USDT-PERPETUAL', 100],
  ]) {
    const r = await get(`get_order_book?instrument_name=${id}${depth === undefined ? '' : `&depth=${depth}`}`);
    const b = r.body.result;
    const desc = (a) => a.every((x, i) => i === 0 || Number(x[0]) < Number(a[i - 1][0]));
    const asc = (a) => a.every((x, i) => i === 0 || Number(x[0]) > Number(a[i - 1][0]));
    log('rest_book', {
      id,
      depth: depth ?? 'absent',
      status: r.status,
      bytes: r.bytes,
      ms: r.ms,
      bids: b.bids.length,
      asks: b.asks.length,
      bidsDescending: desc(b.bids),
      asksAscending: asc(b.asks),
      version: b.version,
      timestampAgeMs: Date.now() - Number(b.timestamp),
      top: [b.bids[0], b.asks[0]],
      keys: Object.keys(b),
      usDiff: r.body.usDiff,
    });
    await sleep(350);
  }
  log('ticker_touch_for_size_unit', { bid: [t.best_bid_price, t.best_bid_amount], ask: [t.best_ask_price, t.best_ask_amount], openInterest: t.open_interest });

  // Three reads 50 ms apart show whether the book is cached.
  const versions = [];
  for (let i = 0; i < 3; i++) {
    const r = await get('get_order_book?instrument_name=BTC-USDT-PERPETUAL&depth=20');
    versions.push({ version: r.body.result.version, ts: r.body.result.timestamp, ms: r.ms });
    await sleep(50);
  }
  log('rest_book_cache', { versions });
}

async function errors() {
  const cases = [
    ['unknown instrument, book', 'get_order_book?instrument_name=NOPE-USDT-PERPETUAL'],
    ['unknown instrument, ticker', 'tickers?instrument_name=NOPE-USDT-PERPETUAL'],
    ['missing parameter, book', 'get_order_book'],
    ['unknown method', 'get_nope'],
    ['wrong currency, instruments', 'get_instruments?currency=NOPE'],
    ['spot id on book', 'get_order_book?instrument_name=BTC-USDT-SPOT&depth=5'],
    ['ccxt style id on book', 'get_order_book?instrument_name=BTCUSDT&depth=5'],
    ['tickers with no parameter', 'tickers'],
    ['funding rate with no instrument', 'get_funding_rate'],
    ['time method', 'get_time'],
    ['index price method', 'get_index_price?index_name=btc_usdt'],
    ['v1 funding history, GET', 'get_funding_rate_history?instrument_name=BTC-USDT-PERPETUAL'],
    ['v1 funding history, GET with a window', 'get_funding_rate_history?instrument_name=BTC-USDT-PERPETUAL&start_timestamp=1789900000000&end_timestamp=1790133000000'],
  ];
  for (const [what, path] of cases) {
    const r = await get(path);
    log('error_case', { what, path, status: r.status, body: r.text.slice(0, 220), retryAfter: r.headers.get('retry-after') });
    await sleep(300);
  }
  const post = await get('get_order_book', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: '/public/get_order_book', params: { instrument_name: 'BTC-USDT-PERPETUAL', depth: 1 } }),
  });
  log('post_jsonrpc_body', { status: post.status, body: post.text.slice(0, 220) });
  const hdr = await get('tickers?instrument_name=BTC-USDT-PERPETUAL');
  log('response_headers', { headers: Object.fromEntries(hdr.headers.entries()) });
}

async function time() {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('tickers?instrument_name=BTC-USDT-PERPETUAL');
    const t1 = Date.now();
    const mid = (t0 + t1) / 2;
    rows.push({ rtt: t1 - t0, usIn: r.body.usIn, usOut: r.body.usOut, usDiff: r.body.usDiff, offsetMs: Math.round(r.body.usIn - mid), date: r.headers.get('date') });
    await sleep(300);
  }
  log('server_time', { rows, offsetMs: stats(rows.map((r) => r.offsetMs)) });
}

async function history() {
  const inst = (await get('get_instruments?currency=PERPETUAL')).body.result;
  const cap = (await get('get_all_capital_rate')).body.result;
  const capBy = new Map(cap.map((x) => [x.instrumentName, x]));
  const byHours = (h) => inst.find((x) => {
    const c = capBy.get(x.instrument_name);
    return c && (Number(c.endTime) - Number(c.startTime)) / 3_600_000 === h;
  });
  for (const x of [inst.find((i) => i.instrument_name === 'BTC-USDT-PERPETUAL'), byHours(4), byHours(1)]) {
    const t0 = performance.now();
    const res = await fetch('https://www.orangex.com/api/v2/public/get_funding_rate_history', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currentPage: 1, pageSize: 12, params: { instrId: x.instrId } }),
    });
    const body = await res.json();
    const rows = body.result?.data ?? [];
    const times = rows.map((r) => Number(r.time));
    const c = capBy.get(x.instrument_name);
    log('funding_history', {
      id: x.instrument_name,
      instrId: x.instrId,
      status: res.status,
      ms: Math.round(performance.now() - t0),
      total: body.result?.total,
      latest: rows.slice(0, 3).map((r) => `${iso(r.time)} ${r.rate}`),
      spacingHours: [...new Set(times.slice(1).map((t, i) => (times[i] - t) / 3_600_000))],
      allOnTheHour: times.every((t) => t % 3_600_000 === 0),
      capNow: { rate: c.capitalRate, startTime: iso(c.startTime), endTime: iso(c.endTime), currentTime: iso(c.currentTime) },
      lastSettledEqualsCapStart: times[0] === Number(c.startTime),
    });
    await sleep(400);
  }
}

const mode = process.argv[2] ?? 'all';
const modes = { catalog, anchor, book, errors, time, history };
log('start', { mode, at: new Date().toISOString() });
if (mode === 'all') {
  for (const m of ['catalog', 'book', 'errors', 'time', 'history', 'anchor']) await modes[m]();
} else {
  await modes[mode]();
}
log('end', { at: new Date().toISOString() });
