// BTCC REST probe: what a public, unauthenticated client can read, and what the documented OpenAPI hosts answer.
// Public, unauthenticated, read-only. No account, no API key, no order. About 2 to 3 minutes, about 70 requests.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcc/rest-probe.mjs
// Checks, in order:
//   ccxt      whether CCXT 4.5.68 has a BTCC class.
//   dns       the addresses of the web, quote and OpenAPI hosts.
//   access    the Cloudflare trace of www.btcc.com, which names the exit country, and the web IP limit config.
//   fees      the VIP table behind https://www.btcc.com/en-US/fees, cold and warm request time.
//   funding   the web funding rate and funding history calls without a login, then 30 polls of the BTCUSDT rate 2 s apart.
//   quote     the web client's quote REST calls sent without their signature.
//   openapi   the REST host of the Nov 2023 OpenAPI document, on its documented port and on 443.
//   guide     the help centre API guide article that the API key page links, through the Zendesk API.
//   clock     the Date header of www.btcc.com against the local clock.
// Recorded in docs/profiles/btcc/rest.md.
import { createRequire } from 'node:module';
import { promises as dns } from 'node:dns';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const ccxt = require('ccxt');

const WEB = 'https://www.btcc.com';
const ZENDESK = 'https://btccexchange.zendesk.com/api/v2/help_center';
const GUIDE_IDS = ['53597049859737', '53596974363545', '53597011699481', '53597057451417', '24451281100697'];
const UA = { 'User-Agent': 'Mozilla/5.0' };
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timed(url, init = {}, timeoutMs = 10_000) {
  const t0 = performance.now();
  try {
    const res = await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    return { status: res.status, ms: Math.round(performance.now() - t0), bytes: text.length, text, headers: res.headers };
  } catch (e) {
    return { status: 0, ms: Math.round(performance.now() - t0), error: String(e.cause?.code ?? e.cause?.message ?? e.message) };
  }
}

function checkCcxt() {
  const ids = ccxt.exchanges.filter((id) => /btcc/i.test(id));
  log('ccxt', { version: ccxt.version, exchanges: ccxt.exchanges.length, btccIds: ids });
}

async function checkDns() {
  for (const host of ['www.btcc.com', 'wkd2.btloginc.com', 'kapi1.btloginc.com', 'api1.btloginc.com', 'api.btcc.com']) {
    const cname = await dns.resolveCname(host).catch(() => []);
    const a = await dns.resolve4(host).catch((e) => [e.code]);
    log('dns', { host, cname, a });
  }
}

async function checkAccess() {
  const trace = await timed(`${WEB}/cdn-cgi/trace`);
  const kv = Object.fromEntries((trace.text ?? '').trim().split('\n').map((l) => l.split('=')));
  log('trace', { status: trace.status, loc: kv.loc, colo: kv.colo });
  const ip = await timed(`${WEB}/v2/common/getIpLimitConfig`, { method: 'POST' });
  const j = JSON.parse(ip.text);
  const cfg = await timed(`${WEB}/v2/common/getCommonConfig`, { method: 'POST' });
  log('loginRequired', { path: '/v2/common/getCommonConfig', status: cfg.status, body: cfg.text.slice(0, 120) });
  log('ipLimitConfig', { status: ip.status, code: j.code, countryCode: j.data?.countryCode, authCodes: j.data?.authCodes, status_: j.data?.status });
}

async function checkFees() {
  const times = [];
  let last;
  for (let i = 0; i < 6; i++) {
    last = await timed(`${WEB}/v2/common/getVipLevelConditionList`);
    times.push(last.ms);
    await sleep(500);
  }
  const rows = JSON.parse(last.text).data;
  log('vipTable', { status: last.status, bytes: last.bytes, coldMs: times[0], warmMs: times.slice(1) });
  for (const r of rows) {
    log('vip', { level: r.levelName, takerPct: r.takerFee, makerPct: r.makerFee, assetUsdt: r.totalAsset, futures30dUsdt: r.tradeAmount, spot30dUsdt: r.stockTradeAmount });
  }
}

const post = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function checkFunding() {
  // The trade page posts {symbol} with no token, and the funding history page posts a date range and a symbolName.
  for (const [label, init] of [['GET, no body', {}], ['POST {}', post({})]]) {
    const r = await timed(`${WEB}/v2/symbol/getFundrate`, init);
    log('fundingNoSymbol', { label, status: r.status, body: r.text.slice(0, 120) });
  }
  for (const symbol of ['BTCUSDT', 'ETHUSDT', 'CHZUSDT', 'BTCUSD', 'BTCUSDC', 'XAUUSDUSDT', 'BTC/USDT.100x', '3289142', 'NOPEUSDT']) {
    const r = await timed(`${WEB}/v2/symbol/getFundrate`, post({ symbol }));
    log('fundingCurrent', { symbol, status: r.status, ms: r.ms, data: JSON.parse(r.text).data });
    await sleep(300);
  }
  const end = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  for (const symbolName of ['BTCUSDT', 'CHZUSDT', 'BTCUSD', null]) {
    const r = await timed(`${WEB}/v2/symbol/getFundrateLog`, post({ pageNo: 1, pageSize: 30, startTime: start, endTime: end, symbolName }));
    const d = JSON.parse(r.text).data;
    const rows = d?.data ?? [];
    const times = rows.map((x) => x.fundrateTime);
    const steps = [...new Set(times.slice(1).map((t, i) => (times[i] - t) / 3_600_000))];
    const hours = [...new Set(times.map((t) => new Date(t).getUTCHours()))].sort((a, b) => a - b);
    const pct = rows.map((x) => parseFloat(x.fundrateValue));
    const twice = rows.filter((x, i) => i > 0 && rows[i - 1].fundrateTime - x.fundrateTime < 300_000).map((x, i) => ({ at: new Date(x.fundrateTime).toISOString().slice(5, 16), value: x.fundrateValue }));
    const offHour = rows.filter((x) => x.fundrateTime % 3_600_000 !== 0).map((x) => new Date(x.fundrateTime).toISOString().slice(5, 16));
    log('fundingHistory', { symbolName, status: r.status, ms: r.ms, total: d?.total, rows: rows.length, newest: rows[0], oldest: rows.at(-1), stepHours: steps.map((h) => Math.round(h * 1000) / 1000), settleHoursUtc: hours, offHourStamps: offHour, withinFiveMinutesOfTheRowBefore: twice, distinctValues: new Set(pct).size, minPct: pct.length ? Math.min(...pct) : null, maxPct: pct.length ? Math.max(...pct) : null });
    await sleep(300);
  }
}

async function pollFunding() {
  // 30 polls, 2 s apart, of the one public per symbol funding call.
  const values = [];
  const ms = [];
  for (let i = 0; i < 30; i++) {
    const r = await timed(`${WEB}/v2/symbol/getFundrate`, post({ symbol: 'BTCUSDT' }));
    ms.push(r.ms);
    values.push(JSON.parse(r.text).data?.fundrate);
    await sleep(2_000);
  }
  ms.sort((a, b) => a - b);
  log('fundingPoll', { polls: values.length, distinct: [...new Set(values)], changes: values.slice(1).filter((v, i) => v !== values[i]).length, ms: { min: ms[0], p50: ms[15], max: ms.at(-1) } });
}

async function checkQuoteRest() {
  // The web client signs these with an md5 over a key in its bundle, and an unsigned call is what an API client without that key would send.
  for (const path of ['/quot/reqMultiPrdPrice?symbol=3289142', '/quot/getHisTick?code=3289142']) {
    const r = await timed(`${WEB}${path}`);
    log('quoteRestUnsigned', { path, status: r.status, bytes: r.bytes, body: (r.text ?? r.error).slice(0, 80) });
  }
}

async function checkOpenApi() {
  for (const url of ['https://api1.btloginc.com:9081/v1/config/symbollist', 'https://api1.btloginc.com/v1/config/symbollist']) {
    const r = await timed(url, {}, 8_000);
    log('openapi', { url, status: r.status, ms: r.ms, error: r.error, body: r.text?.slice(0, 120) });
  }
}

async function checkGuide() {
  for (const id of GUIDE_IDS) {
    const r = await timed(`${ZENDESK}/en-gb/articles/${id}.json`);
    log('guide', { id, status: r.status, body: (r.text ?? r.error).slice(0, 80) });
  }
  const s = await timed(`${ZENDESK}/articles/search.json?locale=en-gb&query=API`);
  const j = JSON.parse(s.text);
  log('guideSearch', { status: s.status, count: j.count, titles: j.results.map((a) => a.title) });
}

async function checkClock() {
  const offsets = [];
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    const r = await timed(`${WEB}/robots.txt`);
    const t1 = Date.now();
    const server = Date.parse(r.headers.get('date'));
    offsets.push(server - (t0 + t1) / 2);
    await sleep(1_100);
  }
  log('clock', { dateHeaderOffsetMs: offsets.map(Math.round), note: 'Date header has 1 s resolution' });
}

checkCcxt();
await checkDns();
await checkAccess();
await checkFees();
await checkFunding();
await checkQuoteRest();
await checkOpenApi();
await checkGuide();
await checkClock();
await pollFunding();
