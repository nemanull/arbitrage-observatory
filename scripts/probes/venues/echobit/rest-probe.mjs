// Echobit REST probe: host and latency, the futures catalog, the anchor sources (bulk funding, per symbol mark and index klines), the REST book, errors and the server clock.
// Public, unauthenticated, read-only. No API key is sent, and every loop stays far below the published 1,200 GET per 60 s.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/echobit/rest-probe.mjs [catalog|anchor|book]
//   catalog  DNS, cold and warm request times, contract list, tickers and funding coverage, spot count. About 15 s.
//   anchor   60 one second polls of the bulk funding reply plus mark and index klines of three contracts, with one OKX cross-check. About 70 s.
//   book     REST depth limits, level order, caching, cut replies, error shapes, rate limit headers, clock offset. About 30 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/echobit/rest.md.
import { lookup } from 'node:dns/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UAPI = 'https://uapi.echobit.com';
const WEB = 'https://www.echobit.com'; // the website's own API, used only where the documented API has no equivalent
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null;
};

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url, { headers: { 'user-agent': 'observatory-probe' } });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, json, text, headers: Object.fromEntries(res.headers) };
}

async function catalog() {
  for (const host of ['uapi.echobit.com', 'www.echobit.com', 'ws.echobit.com']) {
    const addrs = await lookup(host, { all: true }).catch((e) => [{ address: e.code }]);
    log('dns', { host, addrs: addrs.map((a) => a.address) });
  }

  const urls = {
    time: `${UAPI}/uapi/time`,
    contracts: `${UAPI}/uapi/contract/list`,
    allTickers: `${UAPI}/uapi/exchange/all/tickers`,
    spotList: `${UAPI}/uapi/spot/list`,
    fundRates: `${WEB}/mainapi/contract/fund/rates`,
  };
  const replies = {};
  for (const [name, url] of Object.entries(urls)) {
    const times = [];
    let r;
    for (let i = 0; i < 6; i++) {
      r = await get(url);
      times.push(r.ms);
      await sleep(300);
    }
    replies[name] = r;
    keep(`${name}.json`, r.text);
    log('latency', { name, url, status: r.status, bytes: r.bytes, cold: times[0], warm: times.slice(1), cache: r.headers['x-cache'], pop: r.headers['x-amz-cf-pop'] });
  }

  const contracts = replies.contracts.json.data;
  const count = (f) => contracts.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});
  log('contracts', {
    rows: contracts.length,
    quote: count((x) => x.quoteTokenId),
    baseId: count((x) => x.baseId),
    type: count((x) => x.type),
    showState: count((x) => x.showState),
    symbolIsTokenId: count((x) => x.symbolId === x.tokenId),
    symbolIsBaseSwapQuote: count((x) => x.symbolId === `${x.baseTokenId}-SWAP-${x.quoteTokenId}`),
    indexIsBaseQuote: count((x) => x.indexId === x.baseTokenId + x.quoteTokenId),
    marketPriceScope: count((x) => x.marketPriceScope.join(' to ')),
    multiplier: count((x) => x.multiplier),
    futureListings: contracts.filter((x) => x.showDate > Date.now()).map((x) => `${x.symbolId} ${new Date(x.showDate).toISOString()}`),
  });

  const visible = contracts.filter((x) => x.showState && x.baseId === 1);
  const hidden = contracts.filter((x) => !x.showState);
  const tickers = replies.allTickers.json.data;
  const swapTickers = new Map(tickers.filter((t) => t.s.includes('-SWAP-')).map((t) => [t.s, t]));
  const funds = new Map(replies.fundRates.json.data.map((f) => [f.symbolId, f]));
  log('coverage', {
    visibleUsdt: visible.length,
    hidden: hidden.length,
    hiddenSample: hidden.slice(0, 12).map((x) => x.symbolId),
    tickersTotal: tickers.length,
    swapTickers: swapTickers.size,
    visibleWithTicker: visible.filter((x) => swapTickers.has(x.symbolId)).length,
    hiddenWithTicker: hidden.filter((x) => swapTickers.has(x.symbolId)).length,
    tickersNotInCatalog: [...swapTickers.keys()].filter((s) => !contracts.some((x) => x.symbolId === s)),
    fundRows: funds.size,
    visibleWithFund: visible.filter((x) => funds.has(x.symbolId)).length,
    hiddenWithFund: hidden.filter((x) => funds.has(x.symbolId)).length,
    spotRows: replies.spotList.json.data.length,
    spotTickers: tickers.length - swapTickers.size,
  });

  const byVolume = visible
    .map((x) => ({ s: x.symbolId, qv: Number(swapTickers.get(x.symbolId)?.qv ?? 0) }))
    .sort((a, b) => b.qv - a.qv);
  log('volume', {
    top5: byVolume.slice(0, 5).map((x) => `${x.s} ${Math.round(x.qv)}`),
    rank30: byVolume[29] && `${byVolume[29].s} ${Math.round(byVolume[29].qv)}`,
    bottom3: byVolume.slice(-3).map((x) => `${x.s} ${Math.round(x.qv)}`),
    zeroVolume: byVolume.filter((x) => x.qv === 0).length,
    totalQuoteVolume: Math.round(byVolume.reduce((a, x) => a + x.qv, 0)),
  });
  log('sample', { contract: { ...visible[0], riskLimitList: `${visible[0].riskLimitList.length} tiers`, crossRiskLimitList: `${visible[0].crossRiskLimitList.length} tiers` }, ticker: swapTickers.get('BTC-SWAP-USDT'), fund: funds.get('BTC-SWAP-USDT') });
}

async function anchor() {
  const contracts = (await get(`${UAPI}/uapi/contract/list`)).json.data;
  const tickers = (await get(`${UAPI}/uapi/exchange/all/tickers`)).json.data;
  const qv = new Map(tickers.map((t) => [t.s, Number(t.qv)]));
  const visible = contracts.filter((x) => x.showState && x.baseId === 1).sort((a, b) => (qv.get(b.symbolId) ?? 0) - (qv.get(a.symbolId) ?? 0));
  const picks = [visible[0], visible[1], visible[29]].filter(Boolean);
  log('picks', { picks: picks.map((x) => `${x.symbolId} index ${x.indexId}`) });

  // The kline replies answer an empty array for the contract id and a candle for the index id.
  for (const kind of ['mark', 'index']) {
    for (const sym of [picks[0].symbolId, picks[0].indexId]) {
      const r = await get(`${UAPI}/uapi/exchange/${kind}/klines?symbol=${sym}&interval=1m&limit=1`);
      log('kline_key', { kind, sym, status: r.status, rows: r.json?.data?.length, body: r.text.slice(0, 200) });
    }
  }

  const fund = { ms: [], bytes: [], changes: {}, last: new Map() };
  const series = new Map(picks.map((p) => [p.symbolId, { mark: [], index: [], last: [], markMs: [], indexMs: [] }]));
  const intervals = {};
  const rounds = [];
  const t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    // The seven calls of one round go out together, so a round is one second and not the sum of seven replies.
    const [f, ...klines] = await Promise.all([
      get(`${WEB}/mainapi/contract/fund/rates`),
      ...picks.flatMap((p) => [
        get(`${UAPI}/uapi/exchange/mark/klines?symbol=${p.indexId}&interval=1m&limit=1`),
        get(`${UAPI}/uapi/exchange/index/klines?symbol=${p.indexId}&interval=1m&limit=1`),
      ]),
    ]);
    fund.ms.push(f.ms);
    fund.bytes.push(f.bytes);
    if (i === 0) keep('fund-rates-first.json', f.text);
    for (const row of f.json?.data ?? []) {
      const prev = fund.last.get(row.symbolId);
      if (prev) {
        for (const k of ['fundRate', 'settleRate', 'settleTime', 'nextSettleTime', 'currentTime']) {
          if (prev[k] !== row[k]) fund.changes[k] = (fund.changes[k] ?? 0) + 1;
        }
      }
      fund.last.set(row.symbolId, row);
      if (i === 0) {
        const h = (row.nextSettleTime - row.settleTime) / 3_600_000;
        intervals[h] = (intervals[h] ?? 0) + 1;
      }
    }
    for (const [k, p] of picks.entries()) {
      const s = series.get(p.symbolId);
      const m = klines[2 * k];
      const x = klines[2 * k + 1];
      s.markMs.push(m.ms);
      s.indexMs.push(x.ms);
      s.mark.push(Number(m.json?.data?.[0]?.c));
      s.index.push(Number(x.json?.data?.[0]?.c));
    }
    if (i % 10 === 0) {
      const t = await get(`${UAPI}/uapi/exchange/ticker?symbol=${picks.map((p) => p.symbolId).join(',')}`);
      for (const row of t.json?.data ?? []) series.get(row.s)?.last.push(Number(row.c));
    }
    rounds.push(Date.now() - tick);
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  log('fund_poll', {
    polls: fund.ms.length,
    seconds: Math.round((Date.now() - t0) / 1000),
    roundMsMedian: median(rounds),
    roundMsMax: Math.max(...rounds),
    rows: fund.last.size,
    msMin: Math.min(...fund.ms),
    msMedian: median(fund.ms),
    msP90: pct(fund.ms, 0.9),
    msMax: Math.max(...fund.ms),
    bytes: median(fund.bytes),
    fieldChangesAcrossRows: fund.changes,
    intervalHoursFromFirstReply: intervals,
  });
  const visibleIds = new Set(visible.map((x) => x.symbolId));
  const rows = [...fund.last.values()];
  const rates = rows.map((r) => Number(r.fundRate));
  const visibleRows = rows.filter((r) => visibleIds.has(r.symbolId));
  const visibleRates = visibleRows.map((r) => Number(r.fundRate));
  const visibleIntervals = visibleRows.reduce((m, r) => ((m[(r.nextSettleTime - r.settleTime) / 3_600_000] = (m[(r.nextSettleTime - r.settleTime) / 3_600_000] ?? 0) + 1), m), {});
  log('fund_visible', {
    rows: visibleRows.length,
    intervalHours: visibleIntervals,
    fundRateMin: Math.min(...visibleRates),
    fundRateMax: Math.max(...visibleRates),
    atInterest: visibleRates.filter((r) => r === 0.0001).length,
    hiddenAtMinus2Percent: rows.filter((r) => !visibleIds.has(r.symbolId) && Number(r.fundRate) === -0.02).length,
    oneHourRows: visibleRows.filter((r) => r.nextSettleTime - r.settleTime === 3_600_000).map((r) => r.symbolId),
    twelveHourRows: rows.filter((r) => r.nextSettleTime - r.settleTime === 43_200_000).map((r) => `${r.symbolId}${visibleIds.has(r.symbolId) ? '' : ' hidden'}`),
  });
  log('fund_values', {
    nextSettleTimes: [...new Set(rows.map((r) => r.nextSettleTime))].map((t) => new Date(t).toISOString()),
    settleTimes: [...new Set(rows.map((r) => r.settleTime))].map((t) => new Date(t).toISOString()),
    fundRateMin: Math.min(...rates),
    fundRateMax: Math.max(...rates),
    atInterest: rates.filter((r) => r === 0.0001).length,
    nonzero: rates.filter((r) => r !== 0).length,
    top3: rows.sort((a, b) => Math.abs(b.fundRate) - Math.abs(a.fundRate)).slice(0, 3).map((r) => `${r.symbolId} ${r.fundRate}`),
    currentTimeAge: Date.now() - Number(rows[0].currentTime),
  });
  for (const [sym, s] of series) {
    const changes = (a) => a.slice(1).filter((v, i) => v !== a[i]).length;
    const prem = s.mark.map((m, i) => Math.round(((m - s.index[i]) / s.index[i]) * 1e6));
    const moves = (a) => a.slice(1).map((v, i) => Math.abs(Math.round(((v - a[i]) / a[i]) * 1e6)));
    log('mark_index', {
      sym,
      polls: s.mark.length,
      markChanges: changes(s.mark),
      indexChanges: changes(s.index),
      markMsMedian: median(s.markMs),
      indexMsMedian: median(s.indexMs),
      markMsMax: Math.max(...s.markMs),
      premiumPpmMin: Math.min(...prem),
      premiumPpmMedian: median(prem),
      premiumPpmMax: Math.max(...prem),
      maxIndexMovePpm: Math.max(...moves(s.index)),
      maxMarkMovePpm: Math.max(...moves(s.mark)),
      lastSamples: s.last,
      markFirstLast: [s.mark[0], s.mark.at(-1)],
      indexFirstLast: [s.index[0], s.index.at(-1)],
    });
  }

  // One outside reading of the BTC index, to see whether Echobit's index sits near another venue's.
  const okx = await get('https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT');
  const ech = await get(`${UAPI}/uapi/exchange/index/klines?symbol=BTCUSDT&interval=1m&limit=1`);
  const o = Number(okx.json?.data?.[0]?.idxPx);
  const e = Number(ech.json?.data?.[0]?.c);
  log('okx_cross_check', { okxStatus: okx.status, okxIndex: o, echobitIndex: e, diffPpm: Math.round(((e - o) / o) * 1e6) });
}

async function book() {
  const sym = 'BTC-SWAP-USDT';
  for (const limit of [1, 5, 20, 50, 100, 200, 500, 1000]) {
    const r = await get(`${UAPI}/uapi/exchange/depth?symbol=${sym}&limit=${limit}`);
    const d = r.json?.data?.[0];
    const desc = (a) => a.every((l, i) => i === 0 || Number(l[0]) < Number(a[i - 1][0]));
    const asc = (a) => a.every((l, i) => i === 0 || Number(l[0]) > Number(a[i - 1][0]));
    log('depth', { limit, status: r.status, ms: r.ms, bytes: r.bytes, bids: d?.b?.length, asks: d?.a?.length, bidsDesc: d && desc(d.b), asksAsc: d && asc(d.a), v: d?.v, o: d?.o, ageMs: d && Date.now() - d.t, touch: d && [d.b[0], d.a[0]] });
    if (limit === 20) keep('depth-20.json', r.text);
    await sleep(250);
  }
  const reads = [];
  for (let i = 0; i < 6; i++) {
    const r = await get(`${UAPI}/uapi/exchange/depth?symbol=${sym}&limit=20`);
    reads.push({ ms: r.ms, v: r.json?.data?.[0]?.v, t: r.json?.data?.[0]?.t, cache: r.headers['x-cache'], age: r.headers.age ?? null });
    await sleep(100);
  }
  log('depth_repeat', { reads });

  // The same version can come back with fewer levels than asked, as if a reply for a smaller limit were cached.
  const perps = (await get(`${UAPI}/uapi/contract/list`)).json.data.filter((x) => x.showState && x.baseId === 1).map((x) => x.symbolId);
  const truncation = {};
  for (const s of ['BTC-SWAP-USDT', 'ETH-SWAP-USDT', perps.at(-1)]) {
    const counts = {};
    for (let i = 0; i < 10; i++) {
      const r = await get(`${UAPI}/uapi/exchange/depth?symbol=${s}&limit=100`);
      const d = r.json?.data?.[0];
      const k = d ? `${d.b.length}/${d.a.length}` : 'none';
      counts[k] = (counts[k] ?? 0) + 1;
      await sleep(250);
    }
    truncation[s] = counts;
  }
  log('depth_limit100_level_counts', truncation);

  const spot = await get(`${UAPI}/uapi/exchange/depth?symbol=BTCUSDT&limit=5`);
  log('depth_spot_symbol', { status: spot.status, body: spot.text.slice(0, 220) });

  const errors = {
    unknownSymbol: `${UAPI}/uapi/exchange/depth?symbol=NOPE-SWAP-USDT&limit=5`,
    missingLimit: `${UAPI}/uapi/exchange/depth?symbol=${sym}`,
    missingSymbol: `${UAPI}/uapi/exchange/depth?limit=5`,
    badInterval: `${UAPI}/uapi/exchange/klines?symbol=${sym}&interval=7m&limit=1`,
    unknownPath: `${UAPI}/uapi/contract/fund/rates`,
    privateNoKey: `${UAPI}/uapi/account/v1/available?tokenId=USDT`,
  };
  for (const [name, url] of Object.entries(errors)) {
    const r = await get(url);
    log('error_shape', { name, status: r.status, body: r.text.slice(0, 200) });
    await sleep(250);
  }

  const one = await get(`${UAPI}/uapi/time`);
  const limitHeaders = Object.entries(one.headers).filter(([k]) => /rate|limit|retry|remaining|used/i.test(k));
  log('headers', { limitHeaders, all: Object.keys(one.headers) });

  const samples = [];
  for (let i = 0; i < 10; i++) {
    const sent = Date.now();
    const r = await get(`${UAPI}/uapi/time`);
    const back = Date.now();
    samples.push({ rtt: back - sent, offset: r.json.data - (sent + back) / 2 });
    await sleep(200);
  }
  const best = samples.sort((a, b) => a.rtt - b.rtt)[0];
  log('clock', { bestRtt: best.rtt, offsetMsAtBestRtt: Math.round(best.offset), offsets: samples.map((s) => Math.round(s.offset)) });
}

const mode = process.argv[2] ?? 'catalog';
log('start', { mode, at: new Date().toISOString() });
await { catalog, anchor, book }[mode]();
log('end', { at: new Date().toISOString() });
