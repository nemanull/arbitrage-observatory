// Summarises a settlement capture from settlement-instant-probe.mjs: premium per 30 s bucket, the rate freeze and the next time rollover, and displayed against realised.
// node ../scripts/probes/settlement-instant-analyse.mjs out.jsonl
import fs from 'node:fs';
const file = process.argv[2];
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const meta = rows.find((r) => r.event === 'symbols');
const target = meta.target;
const samples = rows.filter((r) => r.venue && r.bid !== undefined);
const history = rows.filter((r) => r.history);
const keys = [...new Set(samples.map((r) => `${r.venue} ${r.symbol}`))];

const bp = (x) => (x * 1e4).toFixed(1);
const bucketOf = (t) => Math.floor((t - target) / 30_000) * 30;

for (const key of keys) {
  const [venue, symbol] = key.split(' ');
  const s = samples.filter((r) => r.venue === venue && r.symbol === symbol && !r.error).sort((a, b) => a.t - b.t);
  if (s.length === 0) continue;
  console.log(`\n=== ${key}: ${s.length} samples, ${samples.filter((r) => r.venue === venue && r.symbol === symbol && r.error).length} errors`);
  console.log('offset s | samples | mid/index bp min..max | mark/index bp | displayed rate % | next settlement');
  const buckets = new Map();
  for (const r of s) { const b = bucketOf(r.t); if (!buckets.has(b)) buckets.set(b, []); buckets.get(b).push(r); }
  for (const [b, list] of [...buckets.entries()].sort((x, y) => x[0] - y[0])) {
    const mids = list.map((r) => ((r.bid + r.ask) / 2) / r.index - 1);
    const marks = list.map((r) => r.mark / r.index - 1);
    const rates = [...new Set(list.map((r) => r.rate))];
    const nexts = [...new Set(list.map((r) => new Date(r.next).toISOString().slice(11, 16)))];
    console.log(`${String(b).padStart(5)} | ${String(list.length).padStart(3)} | ${bp(Math.min(...mids)).padStart(7)}..${bp(Math.max(...mids)).padEnd(7)} | ${bp(marks[0]).padStart(6)}..${bp(marks[marks.length - 1]).padEnd(6)} | ${rates.map((x) => (x * 100).toFixed(4)).join(' ')} | ${nexts.join(' ')}`);
  }
  // Rate and next rollover instants.
  let lastRate = s[0].rate, lastNext = s[0].next;
  for (const r of s) {
    if (r.next !== lastNext) { console.log(`next settlement rolled ${new Date(lastNext).toISOString().slice(11, 16)} to ${new Date(r.next).toISOString().slice(11, 16)} at sample ${new Date(r.t).toISOString().slice(11, 23)} (${((r.t - target) / 1000).toFixed(1)} s after the instant), rate then ${r.rate}`); lastNext = r.next; }
    if (r.rate !== lastRate && Math.abs(r.t - target) < 90_000) { console.log(`rate ${lastRate} to ${r.rate} at ${new Date(r.t).toISOString().slice(11, 23)} (${((r.t - target) / 1000).toFixed(1)} s)`); }
    lastRate = r.rate;
  }
  const before = s.filter((r) => r.t < target).at(-1);
  const h = history.find((r) => r.venue === venue && r.symbol === symbol);
  const settled = h?.history.find((x) => x.at === target) ?? h?.history[0];
  console.log(`last displayed before the instant ${before?.rate} at ${new Date(before?.t).toISOString().slice(11, 23)}, realised ${settled ? `${settled.rate} at ${new Date(settled.at).toISOString().slice(11, 16)}` : 'not in history yet'}; history ${JSON.stringify(h?.history)}`);
}
