// HitBTC REST API v3 probe for the USDT perpetuals (`*_PERP`): host and latency, the catalog against CCXT, the bulk futures/info anchor call, the mark formula, funding history, the REST book, and error shapes.
// Public, unauthenticated, read-only. The anchor mode makes one request a second, far inside the documented 30 per second on /public/*.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/hitbtc/rest-probe.mjs [host|catalog|anchor|history|book|errors]
//   host     DNS, cold and warm request time, the Date header and the futures/info timestamp against the local clock.
//   catalog  public/symbol by type and status, and CCXT 4.5.68 loadMarkets for hitbtc: swaps, active, taker, contractSize, linear.
//   anchor   public/futures/info once a second for 60 s (POLLS to change): reply size and time, how often each field changes, the republish cadence, stale rows, the mark formula check.
//   history  public/futures/history/funding for every perp: interval between settlements, and the latest settled row against futures/info.
//   book     REST order book of three perps: depth limits, level order, timestamp age, caching, and the 24 h ticker of every working perp.
//   errors   unknown symbol, unknown path, the missing time call, bad depth, suspended and expired contracts.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/hitbtc/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const API = 'https://api.hitbtc.com/api/3';
const OUT = process.env.PROBE_OUT_DIR;
const POLLS = Number(process.env.POLLS ?? 60);
const EIGHT_HOURS_MS = 8 * 3_600_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const q = (xs, p) => xs.slice().sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const stats = (xs) => (xs.length ? { n: xs.length, min: Math.min(...xs), med: q(xs, 0.5), p90: q(xs, 0.9), max: Math.max(...xs) } : { n: 0 });
const r1 = (x) => Math.round(x * 10) / 10;

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path, { headers: { 'user-agent': 'observatory-probe' } });
  const tHead = performance.now();
  const text = await res.text();
  const t1 = performance.now();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return {
    status: res.status,
    bytes: text.length,
    ttfbMs: r1(tHead - t0),
    totalMs: r1(t1 - t0),
    recvAt: Date.now(),
    headers: Object.fromEntries(res.headers),
    text,
    json,
  };
}

async function host() {
  const a = await dns.resolve4('api.hitbtc.com');
  log('dns', { host: 'api.hitbtc.com', a });
  const times = [];
  for (let i = 0; i < 6; i++) {
    const r = await get('/public/futures/info/BTCUSDT_PERP');
    times.push(r.totalMs);
    const serverMs = Date.parse(r.json?.timestamp);
    log('req', {
      i,
      status: r.status,
      ttfbMs: r.ttfbMs,
      totalMs: r.totalMs,
      cfRay: r.headers['cf-ray'],
      cache: r.headers['cf-cache-status'],
      date: r.headers.date,
      localIso: new Date(r.recvAt).toISOString(),
      bodyTimestampMinusLocalMs: serverMs - r.recvAt,
      bodyTimestampMinusLocalPlusHalfRtt: r1(serverMs - (r.recvAt - r.totalMs / 2)),
    });
    await sleep(300);
  }
  log('host_summary', { coldMs: times[0], warm: stats(times.slice(1)) });
}

async function catalog() {
  const r = await get('/public/symbol');
  keep('symbol.json', r.text);
  const rows = Object.entries(r.json);
  const by = {};
  for (const [, v] of rows) {
    const k = `${v.type}|${v.contract_type ?? '-'}|${v.status}`;
    by[k] = (by[k] ?? 0) + 1;
  }
  log('symbol', { status: r.status, bytes: r.bytes, totalMs: r.totalMs, rows: rows.length, byTypeContractStatus: by });
  const perps = rows.filter(([, v]) => v.type === 'futures');
  log('perps', {
    working: perps.filter(([, v]) => v.status === 'working').length,
    notWorking: perps.filter(([, v]) => v.status !== 'working').map(([k, v]) => `${k}:${v.status}`),
    quote: [...new Set(perps.map(([, v]) => v.quote_currency))],
    feeCurrency: [...new Set(perps.map(([, v]) => v.fee_currency))],
    rates: [...new Set(perps.map(([, v]) => `${v.take_rate}/${v.make_rate}`))],
    nonPerpSuffix: perps.filter(([k]) => !k.endsWith('_PERP')).map(([k]) => k),
    sample: perps[0],
  });

  const ccxt = require('ccxt');
  const ex = new ccxt.hitbtc();
  const t0 = performance.now();
  const markets = await ex.loadMarkets();
  const all = Object.values(markets);
  const swaps = all.filter((m) => m.swap);
  log('ccxt', {
    version: ccxt.version,
    loadMs: r1(performance.now() - t0),
    markets: all.length,
    swaps: swaps.length,
    activeSwaps: swaps.filter((m) => m.active).length,
    futures: all.filter((m) => m.future).length,
    takers: [...new Set(swaps.map((m) => m.taker))],
    makers: [...new Set(swaps.map((m) => m.maker))],
    contractSizes: [...new Set(swaps.map((m) => m.contractSize))],
    linear: [...new Set(swaps.map((m) => m.linear))],
    settle: [...new Set(swaps.map((m) => m.settle))],
    spotTakers: [...new Set(all.filter((m) => m.spot).map((m) => m.taker))],
  });
  const statusOf = Object.fromEntries(perps.map(([k, v]) => [k, v.status]));
  log('ccxt_active_vs_status', {
    activeButNotWorking: swaps.filter((m) => m.active && statusOf[m.id] !== 'working').map((m) => `${m.id}:${statusOf[m.id]}`),
  });
  const bases = {};
  for (const m of swaps) bases[`${m.base}/${m.quote}`] = [...(bases[`${m.base}/${m.quote}`] ?? []), m.id];
  log('ccxt_pairs_listed_twice', { twice: Object.entries(bases).filter(([, ids]) => ids.length > 1) });
  log('ccxt_samples', {
    rows: swaps.filter((m) => ['BTCUSDT_PERP', 'SHIBUSDT_PERP', 'HITUSDT_PERP', 'PEPEUSDT_PERP'].includes(m.id)).map((m) => ({
      id: m.id,
      symbol: m.symbol,
      base: m.base,
      quote: m.quote,
      settle: m.settle,
      active: m.active,
      contractSize: m.contractSize,
      taker: m.taker,
      maker: m.maker,
      precision: m.precision,
    })),
  });
  const info = await get('/public/futures/info');
  const infoIds = new Set(Object.keys(info.json));
  log('ids_vs_futures_info', {
    ccxtSwapIds: swaps.length,
    inInfo: swaps.filter((m) => infoIds.has(m.id)).length,
    infoNotInCcxt: [...infoIds].filter((id) => !swaps.some((m) => m.id === id)),
  });
}

function checkMark(row, nowMs, tick) {
  const mark = Number(row.mark_price);
  const index = Number(row.index_price);
  const rf = Number(row.funding_rate);
  const ts = Date.parse(row.timestamp);
  const next = Date.parse(row.next_funding_time);
  const t = next - ts;
  const premiumPpm = (mark / index - 1) * 1e6;
  const predicted = index * (1 + (rf * t) / EIGHT_HOURS_MS);
  const predictedIndicative = index * (1 + (Number(row.indicative_funding_rate) * t) / EIGHT_HOURS_MS);
  return {
    premiumPpm,
    withinHalfTick: Math.abs(mark - predicted) <= tick / 2 + tick * 1e-6,
    withinHalfTickIndicative: Math.abs(mark - predictedIndicative) <= tick / 2 + tick * 1e-6,
    residualPpm: (mark / predicted - 1) * 1e6,
    residualIndicativePpm: (mark / predictedIndicative - 1) * 1e6,
    tsAgeMs: nowMs - ts,
    t,
  };
}

async function anchor() {
  const fields = ['mark_price', 'index_price', 'funding_rate', 'indicative_funding_rate', 'premium_index', 'avg_premium_index', 'interest_rate', 'next_funding_time', 'open_interest', 'timestamp'];
  const prev = new Map();
  const changes = {};
  const perSymbolChanges = new Map();
  const times = [];
  const ttfb = [];
  const sizes = [];
  const residuals = [];
  const residualsInd = [];
  const tsSeen = [];
  const premiums = [];
  const ages = [];
  const statuses = {};
  const headersSeen = new Set();
  const ticks = Object.fromEntries(Object.entries((await get('/public/symbol')).json).map(([k, v]) => [k, Number(v.tick_size)]));
  const maxAge = new Map();
  let halfTick = 0;
  let halfTickInd = 0;
  let first;
  for (let i = 0; i < POLLS; i++) {
    const started = Date.now();
    const r = await get('/public/futures/info');
    statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    times.push(r.totalMs);
    ttfb.push(r.ttfbMs);
    sizes.push(r.bytes);
    for (const h of Object.keys(r.headers)) headersSeen.add(h);
    if (!first) {
      first = r;
      keep('futures-info.json', r.text);
    }
    if (r.status === 200) {
      const btcTs = Date.parse(r.json.BTCUSDT_PERP?.timestamp);
      if (tsSeen[tsSeen.length - 1] !== btcTs) tsSeen.push(btcTs);
      for (const [id, row] of Object.entries(r.json)) {
        if (!row.next_funding_time || Date.parse(row.next_funding_time) < r.recvAt) continue;
        const p = prev.get(id);
        if (p) {
          for (const f of fields) {
            if (p[f] !== row[f]) {
              changes[f] = (changes[f] ?? 0) + 1;
              const s = perSymbolChanges.get(id) ?? {};
              s[f] = (s[f] ?? 0) + 1;
              perSymbolChanges.set(id, s);
            }
          }
        }
        prev.set(id, row);
        const c = checkMark(row, r.recvAt, ticks[id]);
        if (c.withinHalfTick) halfTick++;
        if (c.withinHalfTickIndicative) halfTickInd++;
        maxAge.set(id, Math.max(maxAge.get(id) ?? 0, c.tsAgeMs));
        residuals.push(Math.abs(c.residualPpm));
        residualsInd.push(Math.abs(c.residualIndicativePpm));
        premiums.push(c.premiumPpm);
        ages.push(c.tsAgeMs);
      }
    }
    const wait = 1000 - (Date.now() - started);
    if (wait > 0) await sleep(wait);
  }
  const live = [...prev.keys()];
  log('anchor_reply', {
    polls: POLLS,
    statuses,
    rows: Object.keys(first.json).length,
    liveRows: live.length,
    bytes: stats(sizes),
    totalMs: stats(times),
    ttfbMs: stats(ttfb),
    over1s: times.filter((x) => x > 1000).length,
    cache: first.headers['cf-cache-status'],
    headers: [...headersSeen].filter((h) => /rate|limit|retry|cache|age|etag/i.test(h)),
  });
  log('anchor_changes', { rowPolls: live.length * (POLLS - 1), fieldChanges: changes });
  for (const id of ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'HITUSDT_PERP', 'ZRXUSDT_PERP', 'XTZUSDT_PERP']) {
    log('anchor_symbol_changes', { id, changes: perSymbolChanges.get(id) ?? {} });
  }
  log('mark_formula', {
    note: 'mark against index * (1 + rate * t / 8h), t = next_funding_time - timestamp',
    absResidualPpmWithFundingRate: stats(residuals.map((x) => Math.round(x * 100) / 100)),
    absResidualPpmWithIndicative: stats(residualsInd.map((x) => Math.round(x * 100) / 100)),
    markWithinHalfTickOfFormula: halfTick,
    markWithinHalfTickUsingIndicative: halfTickInd,
    of: residuals.length,
    markEqualsIndex: premiums.filter((x) => x === 0).length,
    premiumPpm: stats(premiums.map((x) => Math.round(x * 10) / 10)),
  });
  log('timestamp_age_ms', stats(ages));
  log('rows_with_timestamp_older_than_5s', { rows: [...maxAge.entries()].filter(([, a]) => a > 5000).map(([id, a]) => `${id}:${a}`) });
  log('republish', { note: 'distinct BTCUSDT_PERP timestamps over the run', distinct: new Set(tsSeen).size, gapsMs: stats(tsSeen.slice(1).map((t, i) => t - tsSeen[i]).filter((g) => g > 0)) });
  const last = [...prev.entries()];
  const rates = {};
  for (const [, row] of last) rates[row.funding_rate] = (rates[row.funding_rate] ?? 0) + 1;
  const diff = last.filter(([, row]) => row.funding_rate !== row.indicative_funding_rate).map(([id, row]) => `${id}:${row.funding_rate}/${row.indicative_funding_rate}/${row.avg_premium_index}`);
  log('anchor_rates', { fundingRates: rates, rateNotIndicative: diff.length, examples: diff.slice(0, 6) });
  const dead = Object.entries(first.json).filter(([, row]) => !row.next_funding_time || Date.parse(row.next_funding_time) < first.recvAt);
  log('anchor_dead_rows', { rows: dead.map(([id, row]) => `${id}:next=${row.next_funding_time}:mark=${row.mark_price}:index=${row.index_price}:rate=${row.funding_rate}`) });
  log('anchor_sample', { BTCUSDT_PERP: prev.get('BTCUSDT_PERP') });
}

async function history() {
  const info = (await get('/public/futures/info')).json;
  const r = await get('/public/futures/history/funding?limit=4');
  keep('funding-history.json', r.text);
  log('history_reply', { status: r.status, bytes: r.bytes, totalMs: r.totalMs, contracts: Object.keys(r.json ?? {}).length });
  const gaps = {};
  const infoVsLatest = { rateEqual: 0, rateDiffers: [], nextEqual: 0, avgPremiumEqual: 0, compared: 0 };
  const lag = [];
  for (const [id, rows] of Object.entries(r.json)) {
    for (let i = 1; i < rows.length; i++) {
      const g = (Date.parse(rows[i - 1].timestamp) - Date.parse(rows[i].timestamp)) / 3_600_000;
      const k = g.toFixed(2);
      gaps[k] = (gaps[k] ?? 0) + 1;
    }
    for (const row of rows) lag.push(Date.parse(row.timestamp) % 3_600_000);
    const now = info[id];
    if (!now || !rows.length || !now.next_funding_time || Date.parse(now.next_funding_time) < Date.now()) continue;
    infoVsLatest.compared++;
    if (now.funding_rate === rows[0].funding_rate) infoVsLatest.rateEqual++;
    else infoVsLatest.rateDiffers.push(`${id}:${now.funding_rate}/${rows[0].funding_rate}`);
    if (now.next_funding_time === rows[0].next_funding_time) infoVsLatest.nextEqual++;
    if (now.avg_premium_index === rows[0].avg_premium_index) infoVsLatest.avgPremiumEqual++;
  }
  log('history_gaps_hours', gaps);
  log('history_timestamp_ms_past_hour', stats(lag));
  log('history_vs_info', infoVsLatest);
  log('history_btc', { rows: r.json.BTCUSDT_PERP });
  // A settled rate is avg_premium + clamp(interest - avg_premium, -0.0005, 0.0005), per the funding article.
  let fits = 0;
  let total = 0;
  const misfits = [];
  for (const [id, rows] of Object.entries(r.json)) {
    for (const row of rows) {
      const p = Number(row.avg_premium_index);
      const i = Number(row.interest_rate);
      const rf = p + Math.max(-0.0005, Math.min(0.0005, i - p));
      total++;
      if (Math.abs(rf - Number(row.funding_rate)) < 1e-9) fits++;
      else misfits.push(`${id}@${row.timestamp}:${row.funding_rate}/${rf}`);
    }
  }
  log('history_formula', { fits, total, misfits: misfits.slice(0, 6) });
  const deep = await get('/public/futures/history/funding/BTCUSDT_PERP?limit=30');
  const ts = deep.json.map((x) => x.timestamp.slice(11, 23));
  log('history_btc_30', { status: deep.status, settlementClockTimes: [...new Set(ts.map((x) => x.slice(0, 5)))], offsetsMs: stats(deep.json.map((x) => Date.parse(x.timestamp) % 3_600_000)), rates: [...new Set(deep.json.map((x) => x.funding_rate))] });
}

async function book() {
  for (const id of ['BTCUSDT_PERP', 'ETHUSDT_PERP', 'HITUSDT_PERP']) {
    for (const depth of [0, 20, 100]) {
      const r = await get(`/public/orderbook/${id}?depth=${depth}`);
      const b = r.json;
      const bids = (b.bid ?? []).map((l) => Number(l[0]));
      const asks = (b.ask ?? []).map((l) => Number(l[0]));
      log('book', {
        id,
        depth,
        status: r.status,
        bytes: r.bytes,
        totalMs: r.totalMs,
        bids: bids.length,
        asks: asks.length,
        bidsDescending: bids.every((p, i) => i === 0 || p < bids[i - 1]),
        asksAscending: asks.every((p, i) => i === 0 || p > asks[i - 1]),
        top: { bid: b.bid?.[0], ask: b.ask?.[0] },
        timestampAgeMs: r.recvAt - Date.parse(b.timestamp),
        timestamp: b.timestamp,
        cache: r.headers['cf-cache-status'],
      });
      await sleep(200);
    }
  }
  const multi = await get('/public/orderbook?symbols=BTCUSDT_PERP,ETHUSDT_PERP&depth=5');
  log('book_multi', { status: multi.status, keys: Object.keys(multi.json ?? {}), bytes: multi.bytes });
  const repeats = [];
  for (let i = 0; i < 5; i++) {
    const r = await get('/public/orderbook/BTCUSDT_PERP?depth=5');
    repeats.push(r.json.timestamp);
    await sleep(100);
  }
  log('book_repeat_timestamps', { repeats });
  const sym = (await get('/public/symbol')).json;
  const perpIds = Object.keys(sym).filter((k) => sym[k].type === 'futures' && sym[k].status === 'working');
  const t = await get(`/public/ticker?symbols=${perpIds.join(',')}`);
  const rows = Object.entries(t.json);
  const vols = rows.map(([id, v]) => [id, Number(v.volume_quote)]).sort((a, b) => b[1] - a[1]);
  log('perp_tickers', {
    status: t.status,
    rows: rows.length,
    noBid: rows.filter(([, v]) => v.bid === null).map(([id]) => id),
    noAsk: rows.filter(([, v]) => v.ask === null).map(([id]) => id),
    zeroVolume: rows.filter(([, v]) => Number(v.volume_quote) === 0).map(([id]) => id),
    top5QuoteVolume: vols.slice(0, 5),
    median: vols[Math.floor(vols.length / 2)],
    totalQuoteVolume: Math.round(vols.reduce((s, [, v]) => s + v, 0)),
  });
}

async function errors() {
  const cases = [
    '/public/futures/info/NOPEUSDT_PERP',
    '/public/futures/info?symbols=NOPEUSDT_PERP',
    '/public/orderbook/NOPEUSDT_PERP',
    '/public/orderbook/BTCUSDT_PERP?depth=-1',
    '/public/nope',
    '/public/time',
    '/public/futures/info/PEPEUSDT_PERP',
    '/public/futures/info/TONUSDT_PERP',
    '/public/orderbook/PEPEUSDT_PERP?depth=5',
    '/public/orderbook/TONUSDT_PERP?depth=5',
    '/public/symbol/TONUSDT_PERP',
    '/public/futures/history/funding/NOPEUSDT_PERP',
  ];
  for (const path of cases) {
    const r = await get(path);
    log('error_case', { path, status: r.status, body: r.text.slice(0, 260) });
    await sleep(200);
  }
}

const modes = { host, catalog, anchor, history, book, errors };
const mode = process.argv[2] ?? 'host';
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
await modes[mode]();
