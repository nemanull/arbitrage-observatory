// BTCC quote WebSocket probe: the documented OpenAPI quote host, and the quote socket the public web page uses.
// Public, unauthenticated, read-only. No account, no API key, no order. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts.
// Run from server/: node --max-old-space-size=512 ../scripts/probes/venues/btcc/ws-probe.mjs [official|web|silence|deflate]
//   official  the host of the Nov 2023 OpenAPI quote document, at its documented root and at the web socket path, with and without certificate checks, no login sent. About 15 s.
//   web       the web page's quote socket: silence before login, the anonymous login the page sends, the dictionary, the board, and a 45 s depth subscription. About 70 s.
//   silence   two logged in sockets that never send KeepLive, one idle and one subscribed, for up to 100 s.
//   deflate   offers permessage-deflate once and prints what the server negotiates.
// The web login frame carries the constant `key` and a random `name` that the public web page sends for every visitor who is not logged in, copied from its bundle on 2026-09-22.
// It is not an account key, and the OpenAPI document says an API client logs in with its own account number and registered key instead.
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/btcc/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const OFFICIAL_URL = 'wss://kapi1.btloginc.com:9082';
const WEB_URL = 'wss://wkd2.btloginc.com/quot/reqloginNew';
const WEB_KEY = 'dc8ea0d3-7fce-489c-b6fb-7aa0da48ea65';
const HEADERS = { Origin: 'https://www.btcc.com', 'User-Agent': 'Mozilla/5.0' };
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, name), text.slice(0, 4000) + '\n');
}

function open(url, opts = {}) {
  const t0 = performance.now();
  const ws = new WebSocket(url, { perMessageDeflate: false, headers: HEADERS, handshakeTimeout: 10_000, ...opts });
  const state = { ws, t0, frames: [], openMs: null, closed: null, error: null, upgrade: null, pings: 0, pingAt: [] };
  ws.on('ping', () => { state.pings++; state.pingAt.push(Math.round(performance.now() - t0)); });
  ws.on('upgrade', (res) => { state.upgrade = { status: res.statusCode, ext: res.headers['sec-websocket-extensions'] ?? null, server: res.headers.server }; });
  ws.on('unexpected-response', (_req, res) => { state.error = `unexpected ${res.statusCode}`; ws.terminate(); });
  ws.on('open', () => { state.openMs = Math.round(performance.now() - t0); });
  ws.on('message', (d) => {
    const s = d.toString();
    const at = Math.round(performance.now() - t0);
    let j = null;
    try { j = JSON.parse(s); } catch { /* kept as text */ }
    state.frames.push({ at, wall: Date.now(), len: d.length, j, s: j ? null : s.slice(0, 200) });
    capture('frames.jsonl', JSON.stringify({ at, s }));
  });
  ws.on('close', (code, reason) => { state.closed = { at: Math.round(performance.now() - t0), code, reason: reason.toString() }; });
  ws.on('error', (e) => { state.error ??= e.code ?? e.message; });
  return state;
}

const until = async (pred, ms) => { const end = Date.now() + ms; while (!pred() && Date.now() < end) await sleep(50); return pred(); };
const login = (st) => { const id = String(Math.floor(Math.random() * 1e12)); st.ws.send(JSON.stringify({ name: id, clienttype: 1, company: 1, seq: id, key: WEB_KEY })); };
const byAction = (st, a) => st.frames.filter((f) => f.j?.action === a);

async function official() {
  const verified = open(OFFICIAL_URL);
  await until(() => verified.openMs !== null || verified.error || verified.closed, 10_000);
  log('officialVerified', { url: OFFICIAL_URL, openMs: verified.openMs, error: verified.error });
  verified.ws.terminate();

  // Certificate checks off only to learn what the host serves. A feed would not run this way.
  for (const url of [OFFICIAL_URL, `${OFFICIAL_URL}/quot/reqloginNew`]) {
    const st = open(url, { rejectUnauthorized: false });
    await until(() => st.openMs !== null || st.error || st.closed, 10_000);
    log('officialUnverifiedTls', { url, openMs: st.openMs, upgrade: st.upgrade, error: st.error });
    if (st.openMs !== null) {
      await sleep(12_000);
      log('officialNoLogin12s', { url, frames: st.frames.length, closed: st.closed });
    }
    st.ws.terminate();
  }
}

function dictionarySummary(dict) {
  const byQuote = {};
  const bigByQuote = {};
  for (const d of dict) {
    const quote = d.ShortName.split('/')[1]?.split('.')[0] ?? '?';
    byQuote[quote] = (byQuote[quote] ?? 0) + 1;
    (bigByQuote[quote] ??= {});
    bigByQuote[quote][d.Big] = (bigByQuote[quote][d.Big] ?? 0) + 1;
  }
  const timeTypes = [...new Set(dict.map((d) => d.TimeType))];
  const zones = {};
  for (const d of dict) zones[d.Zone] = (zones[d.Zone] ?? 0) + 1;
  return { count: dict.length, byQuote, zones, timeTypes, bigByQuote };
}

function depthStats(frames, id) {
  const deep = frames.filter((f) => f.j?.action === 'tickinfo_deep').flatMap((f) => f.j.data.map((d) => ({ at: f.at, wall: f.wall, d }))).filter((x) => x.d.Y === id);
  let bidsDesc = 0, asksAsc = 0, repeats = 0, crossed = 0;
  const levels = new Set();
  const ages = [];
  let prev = null;
  for (const { wall, d } of deep) {
    levels.add(`${d.B.length}x${d.A.length}`);
    const b = d.B.map(Number), a = d.A.map(Number);
    if (b.every((p, i) => i === 0 || p < b[i - 1])) bidsDesc++;
    if (a.every((p, i) => i === 0 || p > a[i - 1])) asksAsc++;
    if (b[0] >= a[0]) crossed++;
    const key = JSON.stringify([d.A, d.B, d.U, d.M]);
    if (key === prev) repeats++;
    prev = key;
    ages.push(wall / 1000 - d.T); // T has one second resolution, so an age under 1 s reads as 0 to 1
  }
  const gaps = deep.slice(1).map((x, i) => x.at - deep[i].at).sort((p, q) => p - q);
  const q = (arr, p) => (arr.length ? Math.round(arr[Math.floor(p * (arr.length - 1))]) : null);
  return { frames: deep.length, levels: [...levels], bidsDesc, asksAsc, crossed, identicalToPrevious: repeats, ageOfTSec: { min: Math.round(Math.min(...ages) * 10) / 10, max: Math.round(Math.max(...ages) * 10) / 10 }, gapMs: { min: q(gaps, 0), p50: q(gaps, 0.5), p90: q(gaps, 0.9), max: q(gaps, 1) }, fields: deep[0] ? Object.keys(deep[0].d) : [] };
}

async function web() {
  const st = open(WEB_URL);
  await until(() => st.openMs !== null || st.error, 10_000);
  log('webOpen', { openMs: st.openMs, upgrade: st.upgrade, error: st.error });
  await sleep(8_000);
  log('webBeforeLogin8s', { frames: st.frames.length });

  const tLogin = performance.now() - st.t0;
  login(st);
  await until(() => byAction(st, 'Dict').length > 0, 10_000);
  const loginFrame = byAction(st, 'Login')[0];
  const dictFrame = byAction(st, 'Dict')[0];
  const products = byAction(st, 'All Products')[0];
  log('webLogin', { afterMs: loginFrame ? Math.round(loginFrame.at - tLogin) : null, login: loginFrame?.j, localSec: Math.floor(Date.now() / 1000) });
  log('webProducts', { at: products?.at, bytes: products?.len, rows: products?.j.data.length, names: new Set(products?.j.data.map((p) => p.szname)).size });
  const dict = dictFrame.j.data.DictInfo;
  log('webDict', { bytes: dictFrame.len, Num: dictFrame.j.data.Num, ...dictionarySummary(dict) });
  // `All Products` carries trading hours, so a contract in it with less than a full day is not a 24/7 crypto perpetual.
  const flat = (d) => d.ShortName.replace('/', '').replace(/\..*$/, '');
  const dictByFlat = new Map(dict.map((d) => [flat(d), d]));
  const scheduled = [...new Set(products.j.data.map((p) => p.szname))].filter((n) => dictByFlat.has(n));
  const partDay = scheduled.filter((n) => products.j.data.some((p) => p.szname === n && p.schedule.some((w) => !(w.begin === 0 && w.end >= 1439))));
  const quoteOf = (n) => dictByFlat.get(n).ShortName.split('/')[1].split('.')[0];
  const countBy = (names) => names.reduce((m, n) => ({ ...m, [quoteOf(n)]: (m[quoteOf(n)] ?? 0) + 1 }), {});
  log('webSchedules', { inDictionary: countBy(scheduled), shorterThanADay: countBy(partDay), usdtShorterThanADay: partDay.filter((n) => quoteOf(n) === 'USDT') });
  const families = {};
  for (const d of dict) (families[d.ShortName.split('/')[0]] ??= []).push(d.ShortName.split('/')[1].split('.')[0]);
  const multi = Object.entries(families).filter(([, q]) => q.length > 1);
  const leverage = {};
  for (const d of dict) { const x = d.ShortName.match(/\.(\d+)x$/)?.[1] ?? '?'; leverage[x] = (leverage[x] ?? 0) + 1; }
  log('webPairs', { names: new Set(dict.map((d) => d.ShortName.replace(/\..*$/, ''))).size, basesInSeveralFamilies: multi.length, examples: multi.slice(0, 6).map(([b, q]) => `${b}:${q.join('+')}`), maxLeverage: leverage, scaledNames: dict.map((d) => d.ShortName).filter((n) => /^(10+|1M)[A-Z]/.test(n)) });
  const find = (prefix) => dict.find((d) => d.ShortName.startsWith(prefix));
  const btc = find('BTC/USDT.'), eth = find('ETH/USDT.'), chz = find('CHZ/USDT.'), btcUsd = find('BTC/USD.'), btcUsdc = find('BTC/USDC.');
  log('webIds', { btc: [btc.SecID, btc.ShortName, btc.Digit], eth: [eth.SecID, eth.ShortName], chz: [chz.SecID, chz.ShortName, chz.Digit], btcUsd: [btcUsd.SecID, btcUsd.ShortName], btcUsdc: [btcUsdc.SecID, btcUsdc.ShortName] });

  const zones = [...new Set(dict.map((d) => d.Zone))];
  st.ws.send(JSON.stringify({ action: 'ReqRealPanel', zone: zones, seq: 1 }));
  await sleep(2_000);
  const panels = byAction(st, 'Panel').map((f) => ({ TypeID: f.j.data.TypeID, n: f.j.data.Panel?.length, bytes: f.len }));
  log('webPanel', { panels, sample: byAction(st, 'Panel')[0]?.j.data.Panel?.[0] });

  const mark = st.frames.length;
  const tSub = performance.now() - st.t0;
  st.ws.send(JSON.stringify({ action: 'ReqSubcri', symbols: [String(btc.SecID), String(eth.SecID), String(chz.SecID)], deep: String(btc.SecID) }));
  const keepRtt = [];
  const keepTimer = setInterval(() => { const t = performance.now(); st.ws.send(JSON.stringify({ action: 'KeepLive' })); const n = byAction(st, 'keeplive').length; until(() => byAction(st, 'keeplive').length > n, 5_000).then((ok) => ok && keepRtt.push(Math.round(performance.now() - t))); }, 15_000);
  await sleep(45_000);
  const sub = st.frames.slice(mark);
  const firstDeep = sub.find((f) => f.j?.action === 'tickinfo_deep');
  const counts = {};
  for (const f of sub) counts[f.j?.action ?? 'text'] = (counts[f.j?.action ?? 'text'] ?? 0) + 1;
  const ticksPerId = {};
  for (const f of sub.filter((x) => x.j?.action === 'tickinfo')) for (const d of f.j.data) ticksPerId[d.Y] = (ticksPerId[d.Y] ?? 0) + 1;
  log('webSubscribe45s', { counts, firstDeepAfterMs: firstDeep ? Math.round(firstDeep.at - tSub) : null, ticksPerId, bytes: sub.reduce((s, f) => s + f.len, 0) });
  log('webDepth', depthStats(sub, String(btc.SecID)));
  const deepFrames = sub.filter((f) => f.j?.action === 'tickinfo_deep');
  log('webDepthFirst', { frame: deepFrames[0]?.j });
  log('webDealSnap', { frame: JSON.stringify(sub.find((f) => f.j?.action === 'dealticksnap')?.j).slice(0, 300) });
  log('webKeepLive', { rttMs: keepRtt, reply: byAction(st, 'keeplive')[0]?.j, serverPings: st.pings, pingAtMs: st.pingAt });

  // Depth of a second contract replaces the first, and an unknown id is answered or ignored.
  const mark2 = st.frames.length;
  st.ws.send(JSON.stringify({ action: 'ReqSubcri', symbols: [String(btc.SecID), String(chz.SecID)], deep: String(chz.SecID) }));
  await sleep(6_000);
  const s2 = st.frames.slice(mark2).filter((f) => f.j?.action === 'tickinfo_deep').flatMap((f) => f.j.data.map((d) => d.Y));
  log('webDeepSwitch', { deepIds: Object.fromEntries([...new Set(s2)].map((y) => [y, s2.filter((x) => x === y).length])), chzFirst: st.frames.slice(mark2).find((f) => f.j?.action === 'tickinfo_deep')?.j });
    const probes = [['deepAsLevelCount', JSON.stringify({ action: 'ReqSubcri', symbols: [String(btc.SecID)], deep: '20' })], ['unknownId', JSON.stringify({ action: 'ReqSubcri', symbols: ['999'], deep: '999' })], ['notJson', 'not json'], ['unknownAction', JSON.stringify({ action: 'NoSuchAction' })]];
  for (const [name, text] of probes) {
    const m = st.frames.length;
    st.ws.send(text);
    await sleep(3_000);
    const after = st.frames.slice(m);
    const c = {};
    for (const f of after) c[f.j?.action ?? 'text'] = (c[f.j?.action ?? 'text'] ?? 0) + 1;
    log('webBadRequest', { name, counts: c, nonTick: after.filter((f) => !['tickinfo', 'tickinfo_deep'].includes(f.j?.action)).slice(0, 2).map((f) => f.j ? JSON.stringify(f.j).slice(0, 200) : JSON.stringify(f.s)), closed: st.closed });
  }
  clearInterval(keepTimer);
  st.ws.close();
  await sleep(300);
}

async function silence() {
  const idle = open(WEB_URL);
  const subscribed = open(WEB_URL);
  await until(() => idle.openMs !== null && subscribed.openMs !== null, 10_000);
  login(idle);
  login(subscribed);
  await until(() => byAction(subscribed, 'Dict').length > 0, 10_000);
  const btc = byAction(subscribed, 'Dict')[0].j.data.DictInfo.find((d) => d.ShortName.startsWith('BTC/USDT.'));
  subscribed.ws.send(JSON.stringify({ action: 'ReqSubcri', symbols: [String(btc.SecID)], deep: String(btc.SecID) }));
  await until(() => idle.closed && subscribed.closed, 100_000);
  const lastAt = (st) => st.frames.at(-1)?.at ?? null;
  log('silenceIdle', { closed: idle.closed, frames: idle.frames.length, lastFrameAt: lastAt(idle), serverPings: idle.pings, pingAtMs: idle.pingAt, held: idle.closed ? null : 100_000 });
  log('silenceSubscribed', { closed: subscribed.closed, frames: subscribed.frames.length, lastFrameAt: lastAt(subscribed), serverPings: subscribed.pings, pingAtMs: subscribed.pingAt, held: subscribed.closed ? null : 100_000 });
  idle.ws.terminate();
  subscribed.ws.terminate();
}

async function deflate() {
  const st = open(WEB_URL, { perMessageDeflate: true });
  await until(() => st.openMs !== null || st.error, 10_000);
  log('deflate', { offered: true, negotiated: st.upgrade?.ext, openMs: st.openMs, error: st.error });
  st.ws.close();
  await sleep(300);
}

const mode = process.argv[2] ?? 'web';
const modes = { official, web, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}`);
  process.exit(1);
}
log('start', { mode, utc: new Date().toISOString() });
await modes[mode]();
log('end', { mode, utc: new Date().toISOString() });
process.exit(0);
