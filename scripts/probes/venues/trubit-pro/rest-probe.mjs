// TruBit Pro futures REST probe: host latency, perpetual catalog, bulk index, mark and funding calls, how often each number changes, REST depth order, error shapes, clock offset, and the spot catalog count.
// Public, unauthenticated, read-only. Every loop stays at 3 requests per second or less, under the documented 1 to 10 per second per IP.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/trubit-pro/rest-probe.mjs [basic|poll|errors]
//   basic   latency, catalog, bulk anchor calls, depth order and size unit, CCXT check, spot count. About 15 s.
//   poll    index, mark and funding for all perpetuals once a second for 60 s, and counts how often each number changed.
//   errors  unknown symbol, missing parameter and unknown path replies.
// Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/trubit-pro/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Loads from server/node_modules as the survey plan asks, and falls back to the root pnpm store once server/ no longer holds a Node install.
function load(name) {
  for (const anchor of ['../../../../server/package.json', '../../../../node_modules/.pnpm/probe-anchor.js']) {
    try {
      return createRequire(new URL(anchor, import.meta.url))(name);
    } catch {}
  }
  throw new Error(`cannot load ${name}`);
}
const ccxt = load('ccxt');

const API = 'https://api-futures.trubit.com/market/api/v1';
const SPOT = 'https://api-spot.trubit.com';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

async function get(url) {
  const t0 = performance.now();
  const res = await fetch(url);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {}
  return { status: res.status, ms, bytes: text.length, text, body, headers: res.headers };
}

async function symbols() {
  const r = await get(`${API}/basic/refData`);
  return r.body.result.map((x) => x.symbol);
}

async function basic() {
  const cold = await get(`${API}/basic/refData`);
  const warm = [];
  for (let i = 0; i < 5; i++) {
    warm.push((await get(`${API}/basic/refData`)).ms);
    await sleep(1100); // refData is documented at 1 per second
  }
  log('latency', { coldMs: cold.ms, warmMs: warm, server: cold.headers.get('server'), via: cold.headers.get('via') });
  keep('refData.json', cold.text);
  const rows = cold.body.result;
  const types = {};
  for (const x of rows) types[x.type] = (types[x.type] || 0) + 1;
  const quotes = {};
  for (const x of rows) {
    const q = x.symbol.match(/(USDT|USDC|USD)$/)?.[1] ?? 'other';
    quotes[q] = (quotes[q] || 0) + 1;
  }
  log('catalog', { count: rows.length, types, quotes, lotSizes: [...new Set(rows.map((x) => x.lotSize))], sample: rows[0], keys: Object.keys(rows[0]) });
  const syms = rows.map((x) => x.symbol);

  for (const path of ['basic/indexPrice', 'basic/markPrice', 'basic/lastPrice', `kLine/fundingRate?symbols=${syms.join(',')}`, 'kLine/fundingRate']) {
    const r = await get(`${API}/${path}`);
    keep(path.split('?')[0].replace('/', '_') + '.json', r.text);
    const res = r.body?.result;
    const n = Array.isArray(res) ? res.length : null;
    const zero = Array.isArray(res) ? res.filter((x) => !(Number(x.price ?? x.rate) !== 0)).length : null;
    const dates = Array.isArray(res) ? [...new Set(res.map((x) => x.date).filter(Boolean))] : null;
    const ages = Array.isArray(res) ? res.map((x) => Date.now() - (x.time ?? x.timestamp)).sort((a, b) => a - b) : [];
    log('anchor', {
      path: path.split('?')[0] + (path.includes('?') ? '?symbols=<all>' : ''),
      status: r.status,
      ms: r.ms,
      bytes: r.bytes,
      rows: n,
      zeroOrNaN: zero,
      dates,
      ageMsMinMedMax: ages.length ? [ages[0], ages[ages.length >> 1], ages[ages.length - 1]] : null,
      first: Array.isArray(res) ? res[0] : r.text.slice(0, 120),
    });
    await sleep(400);
  }
  const idx = new Set((await get(`${API}/basic/indexPrice`)).body.result.map((x) => x.symbol));
  log('coverage', { indexMissing: syms.filter((s) => !idx.has(s)) });

  for (const [sym, level] of [['BTCUSDT', 20], ['ETHUSDT', 20], ['MASKUSDT', 20], ['BTCUSDT', 50]]) {
    const r = await get(`${API}/depth/list?symbol=${sym}&level=${level}`);
    const b = r.body?.result?.buyDepth ?? [];
    const a = r.body?.result?.sellDepth ?? [];
    const desc = b.every((x, i) => i === 0 || x.price < b[i - 1].price);
    const asc = a.every((x, i) => i === 0 || x.price > a[i - 1].price);
    const mark = (await get(`${API}/basic/markPrice?symbols=${sym}`)).body.result[0].price;
    log('depth', {
      sym,
      level,
      status: r.status,
      ms: r.ms,
      bids: b.length,
      asks: a.length,
      bidsDescending: desc,
      asksAscending: asc,
      topBid: b[0],
      topAsk: a[0],
      trades: r.body?.result?.trades?.length,
      otherKeys: Object.keys(r.body?.result ?? {}),
      integerQty: [...b, ...a].every((x) => Number.isInteger(x.qty)),
      topBidQtyInBase: b[0] ? +(b[0].qty / mark).toPrecision(6) : null,
    });
    await sleep(400);
  }

  const t0 = Date.now();
  const r = await get(`${SPOT}/openapi/v1/time`);
  const t1 = Date.now();
  log('clock', { spotServerTime: r.body?.serverTime, offsetMs: r.body ? r.body.serverTime - Math.round((t0 + t1) / 2) : null, rttMs: t1 - t0, futuresDateHeader: cold.headers.get('date') });

  const spot = await get(`${SPOT}/openapi/v1/brokerInfo`);
  const ss = spot.body?.symbols ?? [];
  log('spot', { status: spot.status, symbols: ss.length, trading: ss.filter((s) => s.status === 'TRADING').length, contracts: spot.body?.contracts?.length, options: spot.body?.options?.length, rateLimits: spot.body?.rateLimits });

  const ids = ccxt.exchanges.filter((id) => /trubit|tru/i.test(id));
  log('ccxt', { version: ccxt.version, matches: ids, total: ccxt.exchanges.length });
}

async function poll() {
  const syms = await symbols();
  const watch = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'MASKUSDT', 'XAGUSDT', 'NVDAUSDT'];
  const last = {};
  const changes = {};
  const times = { index: [], mark: [], funding: [] };
  const fundingDates = new Set();
  for (let i = 0; i < 60; i++) {
    const t = Date.now();
    const [ix, mk, fr] = await Promise.all([
      get(`${API}/basic/indexPrice`),
      get(`${API}/basic/markPrice`),
      get(`${API}/kLine/fundingRate?symbols=${syms.join(',')}`),
    ]);
    times.index.push(ix.ms);
    times.mark.push(mk.ms);
    times.funding.push(fr.ms);
    for (const [kind, r, field] of [['index', ix, 'price'], ['mark', mk, 'price'], ['funding', fr, 'rate']]) {
      for (const x of r.body?.result ?? []) {
        if (kind === 'funding') fundingDates.add(x.date);
        const k = `${kind}:${x.symbol}`;
        if (last[k] !== undefined && last[k] !== x[field]) changes[k] = (changes[k] || 0) + 1;
        last[k] = x[field];
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - t)));
  }
  const pct = (a) => {
    const s = [...a].sort((x, y) => x - y);
    return { min: s[0], median: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)], max: s[s.length - 1], over1s: s.filter((x) => x > 1000).length };
  };
  log('pollTimes', { index: pct(times.index), mark: pct(times.mark), funding: pct(times.funding) });
  const count = (kind) => {
    const v = syms.map((s) => changes[`${kind}:${s}`] || 0).sort((a, b) => a - b);
    return { min: v[0], median: v[v.length >> 1], max: v[v.length - 1], neverChanged: v.filter((x) => x === 0).length };
  };
  log('changesIn59Intervals', { index: count('index'), mark: count('mark'), funding: count('funding'), fundingDates: [...fundingDates] });
  log('watched', Object.fromEntries(watch.map((s) => [s, { index: changes[`index:${s}`] || 0, mark: changes[`mark:${s}`] || 0, funding: changes[`funding:${s}`] || 0 }])));
  const premium = syms.map((s) => ({ s, ppm: Math.round((last[`mark:${s}`] / last[`index:${s}`] - 1) * 1e6) })).sort((a, b) => Math.abs(b.ppm) - Math.abs(a.ppm));
  log('markOverIndexPpm', { widest: premium.slice(0, 6), zeroMarkOrIndex: syms.filter((s) => !last[`mark:${s}`] || !last[`index:${s}`]) });
}

async function errors() {
  for (const path of ['depth/list?symbol=NOPEUSDT', 'depth/list', 'basic/markPrice?symbols=NOPEUSDT', 'kLine/fundingRate?symbols=NOPEUSDT', 'basic/nothing', 'depth/list?symbol=BTCUSDT&level=7']) {
    const r = await get(`${API}/${path}`);
    log('error', { path, status: r.status, ms: r.ms, body: r.text.slice(0, 200) });
    await sleep(500);
  }
}

const mode = process.argv[2] ?? 'basic';
await { basic, poll, errors }[mode]();
