// Watches Bitstamp's published funding rate across one settlement instant, to see whether the rate at the instant is the one the history endpoint records and what the displayed rate does after it.
// Run from server/ on Node 24 before a settlement: node ../scripts/probes/bitstamp-settlement-probe.mjs [out.jsonl]
// Settlements are at 00:00, 08:00 and 16:00 UTC. Watching runs from 2 minutes before to 3 minutes after, then the history is read once per market.
// Recorded in docs/profiles/bitstamp/rest.md.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const out = process.argv[2] ?? path.join(os.tmpdir(), 'bitstamp-settlement.jsonl'); // raw captures stay out of the repository
const MARKETS = ['btcusd-perp', 'ethusd-perp', 'asterusd-perp', 'hypeusd-perp', 'wtiusd-perp'];
const EIGHT_H = 8 * 3_600_000;
const target = Math.ceil(Date.now() / EIGHT_H) * EIGHT_H;
const from = target - 2 * 60_000;
const until = target + 3 * 60_000;
const log = (o) => fs.appendFileSync(out, JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`settlement ${new Date(target).toISOString()}, watching from ${new Date(from).toISOString()}`);
if (Date.now() < from) await sleep(from - Date.now());

// The socket pushes every market once a second, so it carries the fine grained view without REST load.
const ws = new WebSocket('wss://ws.bitstamp.net', { perMessageDeflate: false });
ws.on('open', () => {
  for (const m of MARKETS) ws.send(JSON.stringify({ event: 'bts:subscribe', data: { channel: `funding_rate_${m}` } }));
});
ws.on('message', (raw) => {
  const j = JSON.parse(raw.toString());
  if (j.event === 'funding_rate_saved') log({ t: Date.now(), src: 'ws', ...j.data });
});

// One REST read of BTC every 2 s, to compare the REST call with the socket at the same instant.
while (Date.now() < until) {
  const t = Date.now();
  try {
    const r = await (await fetch('https://www.bitstamp.net/api/v2/funding_rate/btcusd-perp/')).json();
    log({ t, src: 'rest', ...r });
  } catch (e) {
    log({ t, src: 'rest', error: e.message });
  }
  await sleep(2_000 - (Date.now() - t));
}
ws.close();

for (const m of MARKETS) {
  const h = await (await fetch(`https://www.bitstamp.net/api/v2/funding_rate_history/${m}/?limit=3`)).json();
  log({ t: Date.now(), src: 'history', symbol: m, ...h });
  await sleep(1_100);
}
console.log('done');
process.exit(0);
