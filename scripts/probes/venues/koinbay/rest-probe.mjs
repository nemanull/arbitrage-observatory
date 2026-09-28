// Koinbay futures REST probe: latency, server time, contract catalog, per contract index call, undocumented ticker_all, depth snapshot and error shapes.
// Public, unauthenticated, read-only. At most about 3 requests per second, since the venue publishes no public rate limit.
// Run from server/: node ../scripts/probes/venues/koinbay/rest-probe.mjs [catalog|anchor|book|errors]
//   catalog  latency, server time offset, /fapi/v1/contracts grouped by type, margin coin and status, fee groups, ticker_all size, CCXT id check.
//   anchor   polls /fapi/v1/index on three contracts once a second for 60 s and counts how often each field changed. About 65 s.
//   book     /fapi/v1/depth at limit 100 and 200 on three contracts: level count, order, sizes against the contract multiplier.
//   errors   unknown contract, lowercase and socket-style names, missing parameter, a signed path without a key.
// Recorded in docs/profiles/koinbay/rest.md.
import { createRequire } from 'node:module';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const API = 'https://futuresopenapi.koinbay.com/fapi/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

async function get(path) {
  const t0 = performance.now();
  const res = await fetch(API + path);
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ms, bytes: text.length, json, text, headers: res.headers };
}

async function catalog() {
  const lat = [];
  for (let i = 0; i < 6; i++) { lat.push((await get('/ping')).ms); await sleep(300); }
  log('latency_ping_ms', { first: lat[0], warm: lat.slice(1) });

  const offsets = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await get('/time');
    const t1 = Date.now();
    offsets.push({ offsetMs: r.json.serverTime - Math.round((t0 + t1) / 2), rttMs: t1 - t0 });
    await sleep(300);
  }
  log('server_time', { offsets, timezone: (await get('/time')).json.timezone });

  const c = await get('/contracts');
  log('contracts_call', { status: c.status, ms: c.ms, bytes: c.bytes, count: c.json.length, headers: Object.fromEntries([...c.headers].filter(([k]) => /server|cache|limit|retry|envoy/i.test(k))) });
  const groups = {};
  const fees = {};
  const mult = {};
  for (const x of c.json) {
    const k = `${x.type}|${x.marginCoin}|side=${x.side}|status=${x.status}`;
    groups[k] = (groups[k] || 0) + 1;
    if (x.status === 1) {
      const f = `open ${x.openTakerFee}/${x.openMakerFee} close ${x.closeTakerFee}/${x.closeMakerFee}`;
      fees[f] = (fees[f] || 0) + 1;
      mult[x.multiplier] = (mult[x.multiplier] || 0) + 1;
    }
  }
  log('contract_groups', { groups });
  log('active_fee_groups', { fees });
  log('active_multipliers', { mult });
  log('odd_contracts', { rows: c.json.filter((x) => x.status === 1 && !(x.type === 'E' && x.marginCoin === 'USDT')).map((x) => ({ symbol: x.symbol, type: x.type, marginCoin: x.marginCoin, side: x.side, multiplier: x.multiplier, multiplierCoin: x.multiplierCoin })) });

  const t = await get('/ticker_all');
  const keys = Object.keys(t.json);
  const stale = keys.filter((k) => Date.now() - t.json[k].time > 86_400_000).length;
  log('ticker_all', { status: t.status, ms: t.ms, bytes: t.bytes, keys: keys.length, olderThanADay: stale, sampleKey: keys[0], fields: Object.keys(t.json[keys[0]]) });

  try {
    const ccxt = require('ccxt');
    log('ccxt', { version: ccxt.version, match: ccxt.exchanges.filter((x) => /koin|bay/i.test(x)) });
  } catch (err) {
    log('ccxt', { error: String(err.message).split('\n')[0] });
  }
}

async function anchor() {
  const names = ['E-BTC-USDT', 'E-ETH-USDT', 'E-SSV-USDT'];
  const last = {};
  const changes = {};
  const ms = [];
  const firstRows = {};
  for (let i = 0; i < 60; i++) {
    const tick = Date.now();
    for (const n of names) {
      const r = await get(`/index?contractName=${n}`);
      ms.push(r.ms);
      if (!r.json || r.json.indexPrice === undefined) { log('index_error', { n, status: r.status, body: r.text.slice(0, 200) }); continue; }
      if (!firstRows[n]) firstRows[n] = r.json;
      changes[n] ??= { indexPrice: 0, tagPrice: 0, currentFundRate: 0, nextFundRate: 0, polls: 0 };
      changes[n].polls++;
      for (const f of ['indexPrice', 'tagPrice', 'currentFundRate', 'nextFundRate']) {
        if (last[n] && last[n][f] !== r.json[f]) changes[n][f]++;
      }
      last[n] = r.json;
    }
    await sleep(Math.max(0, 1000 - (Date.now() - tick)));
  }
  ms.sort((a, b) => a - b);
  log('index_first_rows', { firstRows });
  log('index_changes_over_60_polls', { changes });
  log('index_reply_ms', { p50: ms[Math.floor(ms.length / 2)], p90: ms[Math.floor(ms.length * 0.9)], max: ms[ms.length - 1], n: ms.length });
  const tk = await get('/ticker?contractName=E-BTC-USDT');
  const ix = await get('/index?contractName=E-BTC-USDT');
  log('tag_vs_last', { last: tk.json.last, buy: tk.json.buy, sell: tk.json.sell, tagPrice: ix.json.tagPrice, indexPrice: ix.json.indexPrice });
}

async function book() {
  const c = (await get('/contracts')).json;
  for (const n of ['E-BTC-USDT', 'E-SOL-USDT', 'E-SSV-USDT']) {
    const meta = c.find((x) => x.symbol === n);
    for (const limit of [100, 200]) {
      const r = await get(`/depth?contractName=${n}&limit=${limit}`);
      const { asks, bids, time } = r.json;
      const askAsc = asks.every((l, i) => i === 0 || l[0] > asks[i - 1][0]);
      const bidDesc = bids.every((l, i) => i === 0 || l[0] < bids[i - 1][0]);
      log('depth', { n, limit, status: r.status, ms: r.ms, asks: asks.length, bids: bids.length, askAsc, bidDesc, time, topAsk: asks[0], topBid: bids[0], multiplier: meta.multiplier, topAskBase: asks[0] && asks[0][1] * meta.multiplier });
      await sleep(400);
    }
  }
  const a = await get('/depth?contractName=E-BTC-USDT&limit=5');
  await sleep(200);
  const b = await get('/depth?contractName=E-BTC-USDT&limit=5');
  log('depth_repeat', { sameBody: a.text === b.text, gapMsApprox: 200 + b.ms });
}

async function errors() {
  const paths = ['/index?contractName=E-NOPE-USDT', '/depth?contractName=e_btcusdt', '/depth?contractName=e-btc-usdt', '/depth', '/index', '/ticker?contractName=E-ZIL-USDT', '/index?contractName=E-ZIL-USDT', '/openOrders?contractName=E-BTC-USDT', '/nope'];
  for (const p of paths) {
    const r = await get(p);
    log('error_shape', { path: p, status: r.status, body: r.text.slice(0, 220) });
    await sleep(400);
  }
}

const mode = process.argv[2] || 'catalog';
await ({ catalog, anchor, book, errors })[mode]();
