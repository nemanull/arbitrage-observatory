// Bitget funding settlement probe: whether the published funding rate is the one for the upcoming settlement, and what the bulk calls do across the settlement instant.
// Polls three public endpoints once per second each from 90 s before a settlement to 150 s after it.
// Run from server/: node ../scripts/probes/bitget-settlement-probe.mjs [--at 2026-09-15T08:00:00Z] [--out DIR]
// Without --at it targets the next top of the hour, where the 1 hour contracts settle.
// Recorded in docs/profiles/bitget/rest.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://api.bitget.com';
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const OUT = opt('--out') ?? path.join(os.tmpdir(), 'bitget-probe');
const HOUR = 3_600_000;
const AT = opt('--at') ? Date.parse(opt('--at')) : Math.ceil(Date.now() / HOUR) * HOUR;
const BEFORE_MS = 90_000;
const AFTER_MS = 150_000;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (data) => console.log(JSON.stringify(data));

async function getJson(q) {
  const t0 = Date.now();
  const res = await fetch(API + q, { headers: { accept: 'application/json' } });
  const json = await res.json().catch(() => null);
  return { status: res.status, ms: Date.now() - t0, json, at: Date.now() };
}

// One symbol per interval that settles at AT, picked from the bulk reply.
const first = await getJson('/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES');
const symbols = ['BTCUSDT'];
for (const iv of ['1', '2', '4']) {
  const r = first.json.data.find((x) => x.fundingRateInterval === iv && Number(x.nextUpdate) === AT && x.symbol !== 'BTCUSDT');
  if (r) symbols.push(r.symbol);
}
log({ event: 'plan', at: new Date(AT).toISOString(), symbols, startsIn: Math.round((AT - BEFORE_MS - Date.now()) / 1000) });

const wait = AT - BEFORE_MS - Date.now();
if (wait > 0) await sleep(wait);

const rows = [];
const start = Date.now();
let hIdx = 0;
for (let i = 0; start + i * 1000 < AT + AFTER_MS; i++) {
  const tick = start + i * 1000;
  const w = tick - Date.now();
  if (w > 0) await sleep(w);
  const hSym = symbols[hIdx++ % symbols.length];
  const [f, t, h] = await Promise.all([
    getJson('/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES').catch((e) => ({ error: String(e) })),
    getJson('/api/v2/mix/market/tickers?productType=USDT-FUTURES').catch((e) => ({ error: String(e) })),
    getJson(`/api/v2/mix/market/history-fund-rate?productType=USDT-FUTURES&symbol=${hSym}&pageSize=2`).catch((e) => ({ error: String(e) })),
  ]);
  const row = { tRelS: Math.round((tick - AT) / 1000), fundStatus: f.status, tickStatus: t.status, histStatus: h.status, fundMs: f.ms, tickMs: t.ms };
  for (const s of symbols) {
    const fr = f.json?.data?.find((x) => x.symbol === s);
    const tk = t.json?.data?.find((x) => x.symbol === s);
    row[s] = { fr: fr?.fundingRate, nu: fr?.nextUpdate, iv: fr?.fundingRateInterval, tfr: tk?.fundingRate, mark: tk?.markPrice, index: tk?.indexPrice };
  }
  row.hist = { symbol: hSym, rows: h.json?.data?.map((x) => [x.fundingRate, x.fundingTime]) };
  rows.push(row);
}
fs.writeFileSync(path.join(OUT, `settlement-${new Date(AT).toISOString().replace(/[:.]/g, '')}.json`), JSON.stringify(rows, null, 1));

// Transitions per symbol: when the published rate changed, when nextUpdate rolled, and when the history gained the settlement row.
for (const s of symbols) {
  const changes = [];
  let p = null;
  for (const r of rows) {
    const c = r[s];
    if (p && (c.fr !== p.fr || c.nu !== p.nu || c.tfr !== p.tfr || c.iv !== p.iv)) changes.push({ tRelS: r.tRelS, from: { fr: p.fr, tfr: p.tfr, nu: p.nu, iv: p.iv }, to: { fr: c.fr, tfr: c.tfr, nu: c.nu, iv: c.iv } });
    p = c;
  }
  const hist = rows.filter((r) => r.hist.symbol === s && r.hist.rows).map((r) => ({ tRelS: r.tRelS, latest: r.hist.rows[0] }));
  const histChanges = hist.filter((x, i) => i === 0 || x.latest?.[1] !== hist[i - 1].latest?.[1]);
  const lastBefore = [...rows].reverse().find((r) => r.tRelS < 0)?.[s];
  const firstAfter = rows.find((r) => r.tRelS >= 0)?.[s];
  log({ event: 'summary', symbol: s, publishedChanges: changes, historyLatestChanges: histChanges, lastPublishedBefore: lastBefore, firstPublishedAfter: firstAfter });
}
process.exit(0);
