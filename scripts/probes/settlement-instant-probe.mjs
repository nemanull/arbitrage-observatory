// Watches the symbols with the largest funding rates across one settlement instant on bybit and binance, and appends the realised rate from the history endpoints at the end.
// Run from server/ on Node 24: node ../scripts/probes/settlement-instant-probe.mjs out.jsonl <maxIntervalHours> <hoursAhead>
// The target is the next whole hour plus hoursAhead, and polling runs from twelve minutes before to six minutes after, every two seconds.
import fs from 'node:fs';
const [out, maxIntervalArg, hoursAheadArg] = process.argv.slice(2);
const MAX_INTERVAL = Number(maxIntervalArg ?? 1);
const HOURS_AHEAD = Number(hoursAheadArg ?? 0);
const HOUR = 3_600_000;
const EVERY_MS = 2_000;
const target = Math.ceil(Date.now() / HOUR) * HOUR + HOURS_AHEAD * HOUR;
const pollFrom = target - 12 * 60_000;
const pollUntil = target + 6 * 60_000;
const log = (o) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
const j = async (u) => (await fetch(u)).json();

console.log(`target ${new Date(target).toISOString()}, polling from ${new Date(Math.max(pollFrom, Date.now())).toISOString()} to ${new Date(pollUntil).toISOString()}`);
if (Date.now() < pollFrom) await new Promise((r) => setTimeout(r, pollFrom - Date.now()));

const byb = await j('https://api.bybit.com/v5/market/tickers?category=linear');
const bybSyms = byb.result.list
  .filter((t) => t.fundingRate !== '' && Number(t.fundingIntervalHour) <= MAX_INTERVAL && Number(t.nextFundingTime) === target)
  .sort((a, b) => Math.abs(Number(b.fundingRate)) - Math.abs(Number(a.fundingRate)))
  .slice(0, 6)
  .map((t) => ({ symbol: t.symbol, interval: t.fundingIntervalHour, rate: t.fundingRate, cap: t.fundingCap }));
const bin = await j('https://fapi.binance.com/fapi/v1/premiumIndex');
const info = await j('https://fapi.binance.com/fapi/v1/fundingInfo');
const interval = new Map(info.map((r) => [r.symbol, r.fundingIntervalHours]));
const binSyms = bin
  .filter((r) => (interval.get(r.symbol) ?? 8) <= MAX_INTERVAL && r.nextFundingTime === target)
  .sort((a, b) => Math.abs(Number(b.lastFundingRate)) - Math.abs(Number(a.lastFundingRate)))
  .slice(0, 5)
  .map((r) => ({ symbol: r.symbol, interval: interval.get(r.symbol) ?? 8, rate: r.lastFundingRate }));
log({ t: Date.now(), event: 'symbols', target, bybit: bybSyms, binance: binSyms });
console.log('bybit', JSON.stringify(bybSyms));
console.log('binance', JSON.stringify(binSyms));

let rounds = 0;
while (Date.now() < pollUntil) {
  const t0 = Date.now();
  await Promise.all([
    ...bybSyms.map(async ({ symbol }) => {
      try {
        const r = await j(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`);
        const x = r.result.list[0];
        log({ t: t0, venue: 'bybit', symbol, bid: +x.bid1Price, ask: +x.ask1Price, last: +x.lastPrice, mark: +x.markPrice, index: +x.indexPrice, rate: x.fundingRate === '' ? null : +x.fundingRate, next: +x.nextFundingTime, vtime: +r.time });
      } catch (e) { log({ t: t0, venue: 'bybit', symbol, error: String(e.message).slice(0, 80) }); }
    }),
    ...binSyms.map(async ({ symbol }) => {
      try {
        const [p, b] = await Promise.all([j(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`), j(`https://fapi.binance.com/fapi/v1/ticker/bookTicker?symbol=${symbol}`)]);
        log({ t: t0, venue: 'binance', symbol, bid: +b.bidPrice, ask: +b.askPrice, mark: +p.markPrice, index: +p.indexPrice, rate: +p.lastFundingRate, next: p.nextFundingTime, vtime: p.time });
      } catch (e) { log({ t: t0, venue: 'binance', symbol, error: String(e.message).slice(0, 80) }); }
    }),
  ]);
  rounds++;
  if (rounds % 30 === 0) console.log(`${new Date().toISOString()} round ${rounds}`);
  const wait = EVERY_MS - (Date.now() - t0);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

for (const { symbol } of bybSyms) {
  try { const h = await j(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol}&limit=3`); log({ t: Date.now(), venue: 'bybit', symbol, history: h.result.list.map((x) => ({ rate: +x.fundingRate, at: +x.fundingRateTimestamp })) }); } catch (e) { log({ venue: 'bybit', symbol, historyError: String(e.message) }); }
}
for (const { symbol } of binSyms) {
  try { const h = await j(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${symbol}&limit=3`); log({ t: Date.now(), venue: 'binance', symbol, history: h.map((x) => ({ rate: +x.fundingRate, at: x.fundingTime, mark: +x.markPrice })) }); } catch (e) { log({ venue: 'binance', symbol, historyError: String(e.message) }); }
}
console.log(`done, ${rounds} rounds`);
