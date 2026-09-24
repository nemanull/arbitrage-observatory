// Bitazza public REST probe: latency and clock, the AlphaPoint spot catalog, the bulk Level 1 calls, depth snapshots, error shapes, and the refusals of the bitazza.com hosts.
// Public, unauthenticated, read-only. No limit is published, so every mode stays at or under about five requests a second.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/bitazza/rest-probe.mjs [latency|catalog|book|poll|errors|web|all]
//   latency  DNS, 20 cold and 20 warm Ping calls, clock offset from the Date header and from snapshot times. About 40 s.
//   catalog  GetInstruments, GetProducts, the CMC style summary, the CCXT 4.5.68 exchange list, and CCXT ndax pointed at the Bitazza gateway.
//   book     GetL2Snapshot depth limits, level order, repeat reads for caching, response headers. About 10 s.
//   poll     GetLevel1Summary once a second for 30 polls, reply time and how many rows changed.
//   errors   unknown instrument, missing OMSId, a short burst of 20 calls, unknown path.
//   web      status and Cloudflare verdict of the bitazza.com hosts, one request each.
// Prints compact JSON lines. Set PROBE_OUT_DIR to keep raw replies. Recorded in docs/profiles/bitazza/rest.md.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lookup } from 'node:dns/promises';
import https from 'node:https';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));

const HOST = 'apexapi.bitazza.com';
const API = `https://${HOST}:8443/AP`;
const OMS = 1;
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null;
};
const round = (x, d = 1) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);
const stats = (xs) => ({ n: xs.length, min: round(Math.min(...xs)), median: round(quantile(xs, 0.5)), p90: round(quantile(xs, 0.9)), max: round(Math.max(...xs)) });

function keep(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), text);
}

const warmAgent = new https.Agent({ keepAlive: true, maxSockets: 2 });

// Raw GET so the cold path really opens a new TLS connection and the headers stay visible.
function get(url, { agent = warmAgent, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = https.get(url, { agent, headers: { 'user-agent': 'Mozilla/5.0 (probe)', ...headers }, timeout: 20_000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, headers: res.headers, body, ms: performance.now() - t0, bytes: Buffer.byteLength(body), tEnd: Date.now() });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function getJson(path, opts) {
  const r = await get(`${API}/${path}`, opts);
  let json;
  try {
    json = JSON.parse(r.body);
  } catch {
    json = undefined;
  }
  return { ...r, json };
}

async function latency() {
  const addrs = await lookup(HOST, { all: true });
  log('dns', { host: HOST, addresses: addrs.map((a) => a.address) });
  const cold = [];
  for (let i = 0; i < 20; i++) {
    const r = await get(`${API}/Ping`, { agent: false });
    cold.push(r.ms);
    await sleep(250);
  }
  log('ping_cold', stats(cold));
  const warm = [];
  const offsets = [];
  for (let i = 0; i < 20; i++) {
    const t0 = Date.now();
    const r = await get(`${API}/Ping`);
    warm.push(r.ms);
    const server = Date.parse(r.headers.date);
    // Date has one second resolution, so each call bounds the offset to a window rather than a point.
    offsets.push({ lo: server - r.tEnd, hi: server + 1000 - t0 });
    if (i === 0) log('ping_reply', { status: r.status, body: r.body, headers: pick(r.headers, ['server', 'date', 'content-type', 'cache-control', 'access-control-allow-origin']) });
    await sleep(250);
  }
  log('ping_warm', stats(warm));
  const lo = Math.max(...offsets.map((o) => o.lo));
  const hi = Math.min(...offsets.map((o) => o.hi));
  log('clock_offset_date_header', { server_minus_local_ms_between: [lo, hi], note: 'intersection of 20 one second windows' });

  // The snapshot stamps every level with the time its book last changed, so only the newest stamp of a busy book says anything about the clock.
  const lag = [];
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now();
    const r = await getJson(`GetL2Snapshot?OMSId=${OMS}&InstrumentId=7&Depth=20`);
    const newest = Math.max(...r.json.map((e) => e[2]));
    lag.push({ arrivalMinusNewest: r.tEnd - newest, sentMinusNewest: t0 - newest });
    await sleep(500);
  }
  log('snapshot_time_vs_local', { arrival_minus_newest_ms: stats(lag.map((x) => x.arrivalMinusNewest)), sent_minus_newest_ms: stats(lag.map((x) => x.sentMinusNewest)) });
}

function pick(o, keys) {
  const out = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const countBy = (xs, f) => xs.reduce((m, x) => ((m[f(x)] = (m[f(x)] ?? 0) + 1), m), {});

async function catalog() {
  const inst = await getJson(`GetInstruments?OMSId=${OMS}`);
  keep('GetInstruments.json', inst.body);
  const rows = inst.json;
  log('instruments', {
    status: inst.status, bytes: inst.bytes, ms: round(inst.ms), rows: rows.length,
    instrumentType: countBy(rows, (r) => r.InstrumentType),
    sessionStatus: countBy(rows, (r) => r.SessionStatus),
    quote: countBy(rows, (r) => r.Product2Symbol),
    runningByQuote: countBy(rows.filter((r) => r.SessionStatus === 'Running'), (r) => r.Product2Symbol),
    isDisable: countBy(rows, (r) => r.IsDisable),
    symbolEqualsVenueSymbol: rows.filter((r) => r.Symbol === r.VenueSymbol).length,
    symbolEqualsBaseQuote: rows.filter((r) => r.Symbol === r.Product1Symbol + r.Product2Symbol).length,
    priceCollarEnabled: countBy(rows, (r) => r.PriceCollarEnabled),
  });
  const pairs = countBy(rows, (r) => `${r.Product1Symbol}/${r.Product2Symbol}`);
  log('pairs_listed_twice', { pairs: Object.entries(pairs).filter(([, n]) => n > 1) });
  const btc = rows.find((r) => r.Symbol === 'BTCUSDT');
  log('instrument_sample', { row: btc });
  const stopped = rows.filter((r) => r.SessionStatus !== 'Running').map((r) => r.Symbol);
  log('instruments_not_running', { n: stopped.length, sample: stopped.slice(0, 12) });
  for (const oms of [0, 2]) {
    const r = await getJson(`GetInstruments?OMSId=${oms}`);
    log('instruments_other_oms', { oms, status: r.status, body: r.body.slice(0, 160) });
    await sleep(250);
  }

  const prod = await getJson(`GetProducts?OMSId=${OMS}`);
  log('products', { status: prod.status, rows: prod.json.length, productType: countBy(prod.json, (p) => p.ProductType), marginEnabled: countBy(prod.json, (p) => p.MarginEnabled), isDisabled: countBy(prod.json, (p) => p.IsDisabled) });

  const summary = await getJson('summary');
  keep('summary.json', summary.body);
  const s = summary.json;
  const vol = (q) => s.filter((x) => x.trading_pairs.endsWith(`_${q}`));
  log('summary', {
    status: summary.status, bytes: summary.bytes, ms: round(summary.ms), rows: s.length, keys: Object.keys(s[0]),
    byQuote: Object.fromEntries(['USDT', 'THB', 'USDF', 'BTC', 'USD'].map((q) => [q, { rows: vol(q).length, nonzeroQuoteVolume: vol(q).filter((x) => Number(x.quote_volume) > 0).length, sumQuoteVolume: Math.round(vol(q).reduce((a, x) => a + Number(x.quote_volume), 0)) }])),
    topUsdt: vol('USDT').sort((a, b) => b.quote_volume - a.quote_volume).slice(0, 8).map((x) => `${x.trading_pairs}:${Math.round(x.quote_volume)}`),
  });

  const ccxt = require('ccxt');
  log('ccxt', { version: ccxt.version, bitazzaInList: ccxt.exchanges.includes('bitazza'), alphapointLike: ccxt.exchanges.filter((e) => /ndax|apex|azza/.test(e)) });
  // CCXT has no Bitazza class, and the unmerged PR subclasses ndax, so ndax pointed at the Bitazza gateway shows what a catalog would look like.
  const ex = new ccxt.ndax({ urls: { api: { public: API, private: API } }, options: { omsId: OMS } });
  try {
    const markets = await ex.loadMarkets();
    const list = Object.values(markets);
    const m = markets['BTC/USDT'];
    log('ccxt_ndax_on_bitazza', {
      markets: list.length, active: list.filter((x) => x.active).length, types: countBy(list, (x) => x.type),
      btcusdt: m && { id: m.id, symbol: m.symbol, type: m.type, active: m.active, taker: m.taker, maker: m.maker, contractSize: m.contractSize, linear: m.linear, precision: m.precision },
    });
  } catch (e) {
    log('ccxt_ndax_on_bitazza_error', { error: String(e).slice(0, 300) });
  }
}

function orderOf(levels, side) {
  const ps = levels.filter((e) => e[9] === side).map((e) => e[6]);
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < ps.length; i++) {
    if (ps[i] > ps[i - 1]) asc++;
    else if (ps[i] < ps[i - 1]) desc++;
  }
  return { n: ps.length, ascendingSteps: asc, descendingSteps: desc };
}

async function book() {
  for (const depth of [1, 20, 100, 500, 5000]) {
    const r = await getJson(`GetL2Snapshot?OMSId=${OMS}&InstrumentId=7&Depth=${depth}`);
    const ids = new Set(r.json.map((e) => e[0]));
    log('l2_depth', { instrument: 'BTCUSDT', depth, status: r.status, bytes: r.bytes, ms: round(r.ms), entries: r.json.length, bids: orderOf(r.json, 0), asks: orderOf(r.json, 1), distinctMdUpdateIds: ids.size, actionTypes: countBy(r.json, (e) => e[3]), sideOrder: r.json.map((e) => e[9]).join('').replace(/(.)\1+/g, '$1') });
    if (depth === 20) {
      keep('GetL2Snapshot-BTCUSDT-20.json', r.body);
      log('l2_headers', pick(r.headers, ['server', 'date', 'content-type', 'cache-control', 'etag', 'age', 'x-cache']));
      log('l2_first_bid_and_ask', { bid: r.json.find((e) => e[9] === 0), ask: r.json.find((e) => e[9] === 1) });
    }
    await sleep(300);
  }
  const noDepth = await getJson(`GetL2Snapshot?OMSId=${OMS}&InstrumentId=7`);
  log('l2_no_depth', { status: noDepth.status, entries: Array.isArray(noDepth.json) ? noDepth.json.length : null, body: Array.isArray(noDepth.json) ? undefined : noDepth.body.slice(0, 200) });

  // Two reads 100 ms apart, then ten reads 200 ms apart: an edge cache would repeat the id while the socket shows it moving.
  const seen = [];
  for (let i = 0; i < 10; i++) {
    const r = await getJson(`GetL2Snapshot?OMSId=${OMS}&InstrumentId=7&Depth=20`);
    seen.push({ id: r.json[0]?.[0], ms: round(r.ms) });
    await sleep(i === 0 ? 100 : 200);
  }
  log('l2_repeat_reads', { reads: seen });

  const l1 = await getJson(`GetLevel1?OMSId=${OMS}&InstrumentId=7`);
  log('level1_one', { status: l1.status, ms: round(l1.ms), body: l1.json });

  const thin = await getJson(`GetL2Snapshot?OMSId=${OMS}&Symbol=BTCUSD&Depth=20`);
  log('l2_by_symbol_param', { status: thin.status, body: thin.body.slice(0, 200) });
}

async function poll() {
  let prev;
  const times = [];
  const changed = [];
  let rows = 0;
  let bytes = 0;
  for (let i = 0; i < 30; i++) {
    const t0 = Date.now();
    const r = await getJson(`GetLevel1Summary?OMSId=${OMS}`);
    times.push(r.ms);
    bytes = r.bytes;
    const cur = new Map(r.json.map((s) => JSON.parse(s)).map((x) => [x.InstrumentId, `${x.BestBid}|${x.BestOffer}|${x.LastTradedPx}`]));
    rows = cur.size;
    if (prev) changed.push([...cur].filter(([k, v]) => prev.get(k) !== v).length);
    prev = cur;
    if (i === 0) keep('GetLevel1Summary.json', r.body);
    await sleep(Math.max(0, 1000 - (Date.now() - t0)));
  }
  log('level1_summary_poll', { rows, bytes, ms: stats(times), rowsChangedPerPoll: stats(changed) });
}

async function errors() {
  const cases = [
    `GetL2Snapshot?OMSId=${OMS}&InstrumentId=999999&Depth=20`,
    `GetL2Snapshot?InstrumentId=7&Depth=20`,
    `GetLevel1?OMSId=${OMS}&InstrumentId=999999`,
    `GetInstruments`,
    `NoSuchFunction?OMSId=${OMS}`,
    `GetOMSs`,
    `GetUserInfo`,
  ];
  for (const c of cases) {
    const r = await getJson(c);
    log('error_case', { call: c, status: r.status, body: r.body.slice(0, 200) });
    await sleep(300);
  }
  // A short burst, sequential and one connection, to see whether anything throttles at about the rate a poller would use.
  const statuses = [];
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    const r = await getJson(`GetLevel1?OMSId=${OMS}&InstrumentId=7`);
    statuses.push(r.status);
  }
  log('burst', { calls: 20, seconds: round((Date.now() - t0) / 1000, 2), statuses: countBy(statuses, (s) => s) });
}

async function web() {
  for (const url of ['https://bitazza.com/', 'https://bitazza.com/fees', 'https://api-doc.bitazza.com/', 'https://futures.bitazza.com/', 'https://api.bitazza.com/', 'https://trade.bitazza.com/', 'https://bitazza.co.th/fees']) {
    try {
      const r = await get(url, { agent: false });
      const title = /<title[^>]*>([^<]*)</i.exec(r.body)?.[1]?.trim();
      const verdict = /Sorry, you have been blocked/.test(r.body) ? 'cloudflare_block' : undefined;
      log('web', { url, status: r.status, bytes: r.bytes, server: r.headers.server, location: r.headers.location, title, verdict });
    } catch (e) {
      log('web', { url, error: String(e) });
    }
    await sleep(300);
  }
}

const modes = { latency, catalog, book, poll, errors, web };
const arg = process.argv[2] ?? 'all';
const run = arg === 'all' ? Object.keys(modes) : [arg];
log('start', { modes: run, at: new Date().toISOString() });
for (const m of run) {
  if (!modes[m]) throw new Error(`unknown mode ${m}`);
  await modes[m]();
}
log('end', { at: new Date().toISOString() });
