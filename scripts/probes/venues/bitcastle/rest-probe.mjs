// bitcastle REST probe: host and latency, the futures catalog and fee fields, the mark and funding fields, the funding history,
// the futures REST book set against the book of the venue each pair names as its source (Bybit, MEXC or Binance), error shapes,
// clock offset, the spot catalog for the coverage matrix, and whether CCXT 4.5.68 or CoinGecko's derivatives list know the venue.
// Public, unauthenticated, read-only. No public limit is published, the API key limit is 50 calls per 10 s, and main sends 44 calls in about 32 s, at most about 4 in any second.
// The futures calls are the ones the bitcastle web app makes without a login, and the public API reference documents only the spot ones.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitcastle/rest-probe.mjs [main|poll]
//   main  DNS, 10 latency calls, catalogs, funding history, four books beside their sources, errors, clock, CCXT and CoinGecko. About 40 s.
//   poll  the futures ticker once a second for 60 s beside Bybit's BTCUSDT and ETHUSDT mark. About 65 s.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitcastle/rest.md and fees.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const API = 'https://api.bitcastle.io';
const FUT = `${API}/futures/v1`;
const SPOT = `${API}/exchange/orderbook/v1`;
const OUT = process.env.PROBE_OUT_DIR;
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (arr, p) => {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const stats = (arr) => ({ n: arr.length, min: q(arr, 0), med: q(arr, 0.5), p90: q(arr, 0.9), max: q(arr, 1) });
const count = (arr) => arr.reduce((m, v) => ((m[v] = (m[v] || 0) + 1), m), {});

function save(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url, init) {
  const t0 = performance.now();
  const r = await fetch(url, init);
  const text = await r.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, ms, bytes: text.length, text, json, headers: r.headers };
}

const precisionOf = (scale) => (scale === 0 ? '1' : (1 / 10 ** scale).toFixed(scale));

// Best bid and ask by price, since the wire order is not always best first.
function summarizeLevels(bids, asks) {
  const bp = bids.map((l) => Number(l.price ?? l[0]));
  const ap = asks.map((l) => Number(l.price ?? l[0]));
  const sortedDesc = bp.every((p, i) => i === 0 || p < bp[i - 1]);
  const sortedAsc = ap.every((p, i) => i === 0 || p > ap[i - 1]);
  return {
    bids: bids.length, asks: asks.length, best_bid: bp.length ? Math.max(...bp) : null, best_ask: ap.length ? Math.min(...ap) : null,
    bids_best_first: sortedDesc, asks_best_first: sortedAsc, dup_bid_prices: bp.length - new Set(bp).size, dup_ask_prices: ap.length - new Set(ap).size,
  };
}

async function sourceBook(target, coin) {
  const sym = coin.toUpperCase();
  if (target === 'bybit') {
    const r = await get(`https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${sym}USDT&limit=200`);
    const d = r.json?.result;
    return { status: r.status, url: 'bybit linear orderbook limit 200', bids: (d?.b || []).map(([p, s]) => ({ price: p, amount: s })), asks: (d?.a || []).map(([p, s]) => ({ price: p, amount: s })) };
  }
  if (target === 'binance') {
    const r = await get(`https://fapi.binance.com/fapi/v1/depth?symbol=${sym}USDT&limit=500`);
    return { status: r.status, url: 'binance fapi depth limit 500', body: r.json?.bids ? undefined : r.text.slice(0, 200), bids: (r.json?.bids || []).map(([p, s]) => ({ price: p, amount: s })), asks: (r.json?.asks || []).map(([p, s]) => ({ price: p, amount: s })) };
  }
  if (target === 'mexc') {
    const r = await get(`https://contract.mexc.com/api/v1/contract/depth/${sym}_USDT?limit=200`);
    const d = r.json?.data;
    const c = await get(`https://contract.mexc.com/api/v1/contract/detail?symbol=${sym}_USDT`);
    const cs = Number(c.json?.data?.contractSize || 1);
    return { status: r.status, url: 'mexc contract depth limit 200', contractSize: cs, bids: (d?.bids || []).map(([p, v]) => ({ price: String(p), amount: String(v * cs) })), asks: (d?.asks || []).map(([p, v]) => ({ price: String(p), amount: String(v * cs) })) };
  }
  return null;
}

// Share of bitcastle's levels whose price and size appear on the source book fetched at the same moment.
function overlap(cast, src) {
  const m = new Map();
  for (const l of [...src.bids, ...src.asks]) m.set(Number(l.price), Number(l.amount));
  const all = [...cast.bids, ...cast.asks];
  let price = 0;
  let size = 0;
  for (const l of all) {
    if (m.has(Number(l.price))) {
      price++;
      if (Math.abs(m.get(Number(l.price)) - Number(l.amount)) < 1e-9 * Math.max(1, Number(l.amount))) size++;
    }
  }
  return { cast_levels: all.length, price_found_on_source: price, size_equal_on_source: size };
}

async function main() {
  for (const host of ['api.bitcastle.io', 'socket.bitcastle.io', 'developer.bitcastle.io', 'bitcastle.io']) {
    try {
      const a = await dns.resolve4(host);
      let cname = null;
      try {
        cname = await dns.resolveCname(host);
      } catch {}
      log('dns', { host, a, cname });
    } catch (e) {
      log('dns', { host, error: e.code });
    }
  }

  const lat = [];
  for (let i = 0; i < 10; i++) {
    const r = await get(`${FUT}/settings/symbols`);
    lat.push(r.ms);
    if (i === 0) {
      const h = Object.fromEntries([...r.headers].filter(([k]) => /server|cf-|x-|date|cache|age|via|ratelimit|retry|content-encoding/i.test(k)));
      log('first_request', { status: r.status, ms: r.ms, headers: h });
    }
    await sleep(500);
  }
  log('latency_settings_symbols', { cold_ms: lat[0], warm: stats(lat.slice(1)) });

  // Futures catalog.
  const pairsR = await get(`${FUT}/settings/pair`);
  save('settings-pair.json', pairsR.text);
  const pairs = pairsR.json.data;
  const symR = await get(`${FUT}/settings/symbols`);
  const syms = symR.json.data;
  log('futures_catalog', {
    status: pairsR.status, ms: pairsR.ms, bytes: pairsR.bytes, rows: pairs.length, by_currency: count(pairs.map((p) => p.currency)),
    symbols_call_rows: syms.length, symbols_equal_pairs: syms.length === pairs.length && syms.every((s) => pairs.some((p) => p.pair_name === s)),
    fields: Object.keys(pairs[0]), target: count(pairs.map((p) => p.target)), funding_rate: count(pairs.map((p) => p.funding_rate)),
    funding_interval: count(pairs.map((p) => p.funding_interval)), funding_start_offset_h: count(pairs.map((p) => ((Number(p.funding_start_time) % 28_800_000) / 3_600_000).toString())),
    order_taker: count(pairs.map((p) => p.order_taker_fee_rate)), order_maker: count(pairs.map((p) => p.order_maker_fee_rate)), insurance: count(pairs.map((p) => p.insurance_fee_rate)),
    margin_fee: count(pairs.map((p) => p.margin_fee_rate)), position_taker: count(pairs.map((p) => p.position_taker_fee_rate)), position_maker: count(pairs.map((p) => p.position_maker_fee_rate)),
    deduction_fee_rate: count(pairs.map((p) => p.deduction_fee_rate)), use_deduction_fee: count(pairs.map((p) => String(p.use_deduction_fee))),
    max_leverage: count(pairs.map((p) => String(Math.max(...p.trading_list_leverage)))), maintenance_margin_rate: count(pairs.map((p) => p.maintenance_margin_rate)),
    price_scale: count(pairs.map((p) => String(p.ob_default_price_scale))), status_like_fields: Object.keys(pairs[0]).filter((k) => /status|active|enable|state/.test(k)),
  });
  log('futures_fee_exceptions', { rows: pairs.filter((p) => p.order_taker_fee_rate !== '0.00055').map((p) => `${p.pair_name} order_taker ${p.order_taker_fee_rate} target ${p.target}`) });
  log('futures_targets', { binance: pairs.filter((p) => p.target === 'binance').map((p) => p.pair_name), mexc: pairs.filter((p) => p.target === 'mexc').map((p) => p.pair_name) });
  const feesR = await get(`${FUT}/settings/trading-fees`);
  const fees = feesR.json.data;
  const sameFees = fees.every((f) => {
    const p = pairs.find((x) => x.coin === f.coin && x.currency === f.currency);
    return p && p.order_taker_fee_rate === f.order_taker_fee_rate && p.insurance_fee_rate === f.insurance_fee_rate;
  });
  log('trading_fees_call', { status: feesR.status, rows: fees.length, fields: Object.keys(fees[0]), same_as_pair_settings: sameFees });

  // Mark, last and anything that looks like an anchor.
  const t24 = await get(`${FUT}/ticker/24h`);
  save('ticker-24h.json', t24.text);
  const rows = t24.json.data;
  const inCat = new Set(pairs.map((p) => `${p.coin}/${p.currency}`));
  const tick = await get(`${FUT}/ticker`);
  log('futures_ticker_24h', {
    status: t24.status, ms: t24.ms, bytes: t24.bytes, rows: rows.length, fields: Object.keys(rows[0]), with_mark: rows.filter((r) => Number(r.mark_price) > 0).length,
    mark_zero_or_missing: rows.filter((r) => !(Number(r.mark_price) > 0)).map((r) => `${r.coin}/${r.currency}`),
    not_in_catalog: rows.filter((r) => !inCat.has(`${r.coin}/${r.currency}`)).map((r) => `${r.coin}/${r.currency}`),
    catalog_without_ticker: [...inCat].filter((s) => !rows.some((r) => `${r.coin}/${r.currency}` === s)),
    top_level_keys: Object.keys(t24.json), server_timestamp: t24.json.timestamp,
    ticker_call: { status: tick.status, body: tick.text.slice(0, 120) },
  });
  const btcRow = rows.find((r) => r.coin === 'btc');
  const bybitT = await get('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT');
  const bt = bybitT.json?.result?.list?.[0];
  log('btc_mark_vs_bybit_once', { cast_mark: btcRow?.mark_price, cast_last: btcRow?.price, bybit_mark: bt?.markPrice, bybit_index: bt?.indexPrice, bybit_last: bt?.lastPrice, bybit_funding: bt?.fundingRate, bybit_next_funding: bt?.nextFundingTime });

  // Marks of the two other source families against their source's mark.
  const mexcT = await get('https://contract.mexc.com/api/v1/contract/ticker?symbol=PI_USDT');
  const binP = await get('https://fapi.binance.com/fapi/v1/premiumIndex?symbol=LAYERUSDT');
  const piRow = rows.find((r) => r.coin === 'pi');
  const layerRow = rows.find((r) => r.coin === 'layer');
  log('mark_vs_other_sources_once', {
    pi: { cast_mark: piRow?.mark_price, mexc_status: mexcT.status, mexc_fair: mexcT.json?.data?.fairPrice, mexc_index: mexcT.json?.data?.indexPrice, mexc_last: mexcT.json?.data?.lastPrice },
    layer: { cast_mark: layerRow?.mark_price, binance_status: binP.status, binance_mark: binP.json?.markPrice, binance_index: binP.json?.indexPrice },
  });

  // Funding history: the latest settlement of every pair and one pair's series.
  const fhAll = await get(`${FUT}/funding-rate/history?page=1&limit=200`);
  save('funding-history-all.json', fhAll.text);
  const fa = fhAll.json.data;
  const times = [...new Set(fa.map((r) => r.calculation_time))].sort().reverse();
  const latestBySym = new Map();
  for (const r of fa) if (!latestBySym.has(r.symbol)) latestBySym.set(r.symbol, r);
  const latest = [...latestBySym.values()];
  log('funding_history_all', {
    status: fhAll.status, ms: fhAll.ms, bytes: fhAll.bytes, rows: fa.length, pagination: fhAll.json.pagination, top_level_keys: Object.keys(fhAll.json), timestamp_field: fhAll.json.timestamp,
    fields: Object.keys(fa[0]), calculation_times: times.slice(0, 4).map((t) => new Date(Number(t)).toISOString()),
    symbols_in_page: latest.length, latest_rate_by_value: count(latest.map((r) => r.funding_rate)), interval: count(fa.map((r) => String(r.funding_interval))),
    latest_with_open_interest: latest.filter((r) => Number(r.long_amount) > 0 || Number(r.short_amount) > 0).map((r) => `${r.symbol} ${r.funding_rate} L${Number(r.long_amount)} S${Number(r.short_amount)}`),
  });
  const fhBtc = await get(`${FUT}/funding-rate/history?symbol=btc/usdt&page=1&limit=50`);
  const fb = fhBtc.json.data;
  log('funding_history_btc', {
    status: fhBtc.status, rows: fb.length, total: fhBtc.json.pagination?.total, rates: count(fb.map((r) => r.funding_rate)),
    first: new Date(Number(fb[fb.length - 1].calculation_time)).toISOString(), last: new Date(Number(fb[0].calculation_time)).toISOString(),
    spacing_h: count(fb.slice(1).map((r, i) => String((Number(fb[i].calculation_time) - Number(r.calculation_time)) / 3_600_000))),
    latest: fb[0],
  });
  const fhUnknown = await get(`${FUT}/funding-rate/history?symbol=nope/usdt&page=1&limit=5`);
  log('funding_history_unknown_symbol', { status: fhUnknown.status, body: fhUnknown.text.slice(0, 200) });
  const now = Date.now();
  const btcPair = pairs.find((p) => p.coin === 'btc');
  const intervalMs = Number(btcPair.funding_interval) * 3_600_000;
  const start = Number(btcPair.funding_start_time);
  const next = start + (Math.floor((now - start) / intervalMs) + 1) * intervalMs;
  log('next_funding_derived', { pair: 'btc/usdt', funding_start_time: new Date(start).toISOString(), funding_interval_h: btcPair.funding_interval, next: new Date(next).toISOString(), rule: 'start + (floor((now - start) / interval) + 1) * interval, as the web app countdown computes it' });

  // Books beside their sources.
  for (const coin of ['btc', 'eth', 'pi', 'layer']) {
    const p = pairs.find((x) => x.coin === coin);
    const prec = precisionOf(p.ob_default_price_scale);
    const [cast, src] = await Promise.all([get(`${FUT}/orderbook?coin=${coin}&currency=usdt&precision=${prec}`), sourceBook(p.target, coin)]);
    const ob = cast.json?.data?.orderbook || { bids: [], asks: [] };
    save(`book-${coin}.json`, cast.text);
    log('futures_book', {
      pair: p.pair_name, target: p.target, precision: prec, status: cast.status, ms: cast.ms, bytes: cast.bytes, data_keys: Object.keys(cast.json?.data || {}), current_price: cast.json?.data?.current_price,
      cast: summarizeLevels(ob.bids, ob.asks), source: src ? { status: src.status, url: src.url, contract_size: src.contractSize, body: src.body, ...summarizeLevels(src.bids, src.asks) } : null,
      overlap: src ? overlap(ob, src) : null,
      top3: { bids: ob.bids.slice(0, 3), asks: ob.asks.slice(0, 3) },
    });
    await sleep(600);
  }
  for (const take of [5, 20, 500]) {
    const r = await get(`${FUT}/orderbook?coin=btc&currency=usdt&precision=0.1&take=${take}`);
    const ob = r.json?.data?.orderbook || { bids: [], asks: [] };
    log('book_take', { take, status: r.status, bids: ob.bids.length, asks: ob.asks.length });
    await sleep(500);
  }
  const cacheProbe = [];
  for (let i = 0; i < 4; i++) {
    const r = await get(`${FUT}/orderbook?coin=btc&currency=usdt&precision=0.1`);
    cacheProbe.push({ ms: r.ms, top_bid: r.json?.data?.orderbook?.bids?.[0]?.price, top_ask: r.json?.data?.orderbook?.asks?.[0]?.price, server_ts: r.json?.timestamp });
    await sleep(250);
  }
  log('book_repeat_250ms', { reads: cacheProbe });

  // Errors.
  const errs = [
    ['unknown coin', `${FUT}/orderbook?coin=nope&currency=usdt&precision=0.1`],
    ['missing precision', `${FUT}/orderbook?coin=btc&currency=usdt`],
    ['precision not listed', `${FUT}/orderbook?coin=btc&currency=usdt&precision=0.01`],
    ['ticker unknown coin', `${FUT}/ticker/24h?coin=nope&currency=usdt`],
    ['unknown path', `${FUT}/nope`],
    ['private call without key', `${FUT}/position`],
    ['spot book missing params', `${SPOT}/orderbook`],
  ];
  for (const [label, url] of errs) {
    const r = await get(url);
    log('error', { label, status: r.status, body: r.text.slice(0, 220) });
    await sleep(500);
  }

  // Clock.
  const offs = [];
  const bodyOffs = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get(`${FUT}/settings/symbols`);
    const t1 = Date.now();
    const mid = (t0 + t1) / 2;
    const d = Date.parse(r.headers.get('date'));
    offs.push(Math.round(d + 500 - mid));
    bodyOffs.push(Math.round(Number(r.json.timestamp) - mid));
    await sleep(400);
  }
  log('clock', { date_header_offset_ms: offs, body_timestamp_offset_ms: bodyOffs, note: 'Date has 1 s resolution, so its offset carries +-500 ms' });

  // Spot, for the coverage matrix only.
  const cg = await get(`${SPOT}/cg/v1/pairs`);
  const st = await get(`${SPOT}/ticker/24h`);
  const spotRows = st.json?.data || [];
  log('spot', { cg_pairs_status: cg.status, cg_pairs: Array.isArray(cg.json) ? cg.json.length : cg.text.slice(0, 100), ticker_status: st.status, ticker_rows: spotRows.length, quotes: count(spotRows.map((r) => r.currency)) });
  const gs = await get(`${API}/setting/v2/global-setting`);
  const spotFees = [];
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object') {
      if ('buy_fee' in o && o.coin) spotFees.push(o);
      Object.values(o).forEach(walk);
    }
  };
  walk(gs.json?.data);
  const btcSpot = spotFees.find((p) => p.coin === 'btc' && p.currency === 'usdt');
  log('spot_fees', {
    status: gs.status, bytes: gs.bytes, pair_settings: spotFees.length, btc_usdt: btcSpot && { buy_fee: btcSpot.buy_fee, sell_fee: btcSpot.sell_fee, buy_fee_type: btcSpot.buy_fee_type, obm_active: btcSpot.obm_active },
    usdt_pairs_by_fee: count(spotFees.filter((p) => p.currency === 'usdt').map((p) => `${p.buy_fee}/${p.sell_fee}`)),
  });

  // CCXT and CoinGecko.
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, matches: ccxt.exchanges.filter((x) => /castle/i.test(x)) });
  const cgd = await get('https://api.coingecko.com/api/v3/derivatives/exchanges/list');
  log('coingecko_derivatives_list', { status: cgd.status, entries: Array.isArray(cgd.json) ? cgd.json.length : null, bitcastle: Array.isArray(cgd.json) ? cgd.json.filter((e) => /castle/i.test(e.id + e.name)) : null });
  const cge = await get('https://api.coingecko.com/api/v3/exchanges/bitcastle');
  log('coingecko_exchange', { status: cge.status, trust_score: cge.json?.trust_score, trust_score_rank: cge.json?.trust_score_rank, volume_btc_24h: cge.json?.trade_volume_24h_btc, country: cge.json?.country, year: cge.json?.year_established, pairs: cge.json?.pairs });
}

async function poll() {
  const seen = { btc: [], eth: [] };
  const ms = [];
  const bybit = { btc: [], eth: [] };
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const t0 = Date.now();
    const [r, b] = await Promise.all([
      get(`${FUT}/ticker/24h`),
      get('https://api.bybit.com/v5/market/tickers?category=linear'),
    ]);
    ms.push(r.ms);
    for (const coin of ['btc', 'eth']) {
      const row = r.json?.data?.find((x) => x.coin === coin);
      seen[coin].push({ t: t0, mark: row?.mark_price, last: row?.price });
      const br = b.json?.result?.list?.find((x) => x.symbol === `${coin.toUpperCase()}USDT`);
      bybit[coin].push({ t: t0, mark: br?.markPrice });
    }
    const wait = 1000 - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
  }
  log('ticker_poll', { polls: ms.length, reply_ms: stats(ms) });
  for (const coin of ['btc', 'eth']) {
    const s = seen[coin];
    let markChanges = 0;
    let lastChanges = 0;
    const runs = [];
    let run = 1;
    for (let i = 1; i < s.length; i++) {
      if (s[i].mark !== s[i - 1].mark) {
        markChanges++;
        runs.push(run);
        run = 1;
      } else run++;
      if (s[i].last !== s[i - 1].last) lastChanges++;
    }
    const bm = bybit[coin];
    // For each bitcastle mark, how many polls earlier Bybit showed the same value.
    const lagPolls = [];
    for (let i = 0; i < s.length; i++) {
      for (let k = i; k >= 0; k--) {
        if (Number(bm[k].mark) === Number(s[i].mark)) {
          lagPolls.push(i - k);
          break;
        }
      }
    }
    log('mark_changes', { pair: `${coin}/usdt`, polls: s.length, mark_changes: markChanges, polls_per_mark_value: stats(runs), last_changes: lastChanges, bybit_mark_changes: bm.filter((x, i) => i > 0 && x.mark !== bm[i - 1].mark).length, cast_mark_found_in_bybit_polls: lagPolls.length, polls_behind_bybit: stats(lagPolls) });
  }
}

const mode = process.argv[2] || 'main';
const modes = { main, poll };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { mode, at: new Date().toISOString() });
