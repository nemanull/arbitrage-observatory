// Scratch benchmark for the cluster hot path. Run: node bench-cluster.mjs
// Imports the REAL onQuote from dist (build first: pnpm run build).
import { onQuote } from './dist/engine/core.js';

// ── build-side helpers (mirror the designed buildIndex; not in core.ts yet) ──

function makeCluster(pair, markets) {
  const n = markets.length;
  const c = {
    pair, markets,
    bidMul: new Float64Array(n), askMul: new Float64Array(n),
    bid: new Float64Array(n), ask: new Float64Array(n), recvTs: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    c.bidMul[i] = 1 - markets[i].takerPpm / 1e6;
    c.askMul[i] = 1 + markets[i].takerPpm / 1e6;
  }
  return c;
}

function buildIndex(input) {
  const buckets = new Map();
  for (const m of input) {
    if (!m.linear) continue;
    const pair = `${m.base}|${m.settle}`;
    let b = buckets.get(pair);
    if (!b) buckets.set(pair, (b = []));
    b.push(m);
  }
  const entries = [...buckets.entries()]
    .filter(([, ms]) => ms.length >= 2)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  const index = { clusters: [], idBySymbol: new Map(), slotsByVenue: new Map() };
  for (const [pair, ms] of entries) {
    ms.sort((a, b) => (a.venueId < b.venueId ? -1 : 1));
    const cluster = makeCluster(pair, ms);
    index.clusters.push(cluster);
    ms.forEach((m, i) => {
      const slot = { cluster, i };
      let byVenue = index.idBySymbol.get(m.venueId);
      if (!byVenue) index.idBySymbol.set(m.venueId, (byVenue = new Map()));
      byVenue.set(m.rawMarketId, slot);
      let vs = index.slotsByVenue.get(m.venueId);
      if (!vs) index.slotsByVenue.set(m.venueId, (vs = []));
      vs.push(slot);
    });
  }
  return index;
}

// ── synthetic market set: 400 assets × 5 venues = 2,000 markets ──────────────

const VENUES = [
  ['binanceusdm', 450], ['bybit', 550], ['okx', 500], ['gate', 500], ['krakenfutures', 500],
];
const ASSETS = Array.from({ length: 400 }, (_, i) => `A${String(i).padStart(4, '0')}`);

const markets = [];
for (const [venueId, takerPpm] of VENUES)
  for (const base of ASSETS)
    markets.push({
      venueId, takerPpm, base,
      rawMarketId: `${base}USDT`, settle: 'USDT', linear: true,
    });

const index = buildIndex(markets);
console.log(`index: ${index.clusters.length} clusters, ${markets.length} markets`);

// ── pregenerate 1M messages so the timed loop measures ONLY the hot path ─────
// Quotes jitter ±5ppm around each asset's mid: far inside the fee band, so the
// scan almost always returns null — the realistic common case.

const M = 1_000_000;
const msgVenueMap = new Array(M);   // the feed's inner map (resolved "at startup")
const msgSymbol = new Array(M);     // wire symbol string
const msgBid = new Float64Array(M);
const msgAsk = new Float64Array(M);

for (let i = 0; i < M; i++) {
  const v = VENUES[i % VENUES.length][0];
  const a = ASSETS[(i * 7919) % ASSETS.length];   // spread updates across assets
  const mid = 100 + ((i * 7919) % ASSETS.length);
  const j = (Math.random() - 0.5) * 1e-5;
  msgVenueMap[i] = index.idBySymbol.get(v);
  msgSymbol[i] = `${a}USDT`;
  msgBid[i] = mid * (1 - 1e-5 + j);
  msgAsk[i] = mid * (1 + 1e-5 + j);
}

const NOW = 1_722_400_000_000;
let found = 0;

function pass() {
  for (let i = 0; i < M; i++) {
    const s = msgVenueMap[i].get(msgSymbol[i]);
    if (s !== undefined && onQuote(s, msgBid[i], msgAsk[i], NOW) !== null) found++;
  }
}

pass(); pass();                                   // warmup: let the JIT settle

const ROUNDS = 10;
const t0 = process.hrtime.bigint();
for (let r = 0; r < ROUNDS; r++) pass();
const t1 = process.hrtime.bigint();

const total = ROUNDS * M;
const nsPerOp = Number(t1 - t0) / total;
console.log(`\nhot path (Map.get + onQuote incl. evaluate over 5-member cluster):`);
console.log(`  ${nsPerOp.toFixed(1)} ns/message   (${total.toLocaleString()} messages, ${found} opportunities)`);
console.log(`  at  50k msg/s: ${(nsPerOp * 50e3 / 1e9 * 100).toFixed(2)}% of one core`);
console.log(`  at 500k msg/s: ${(nsPerOp * 500e3 / 1e9 * 100).toFixed(2)}% of one core`);

// ── JSON.parse of a realistic tick, for scale ────────────────────────────────

const tick = '{"topic":"orderbook.1.A0042USDT","ts":1722400000000,"type":"snapshot","data":{"s":"A0042USDT","b":"142.0021","a":"142.0049","bs":"2.415","as":"1.102","u":8271654,"seq":992716}}';
let sink = 0;
const P = 2_000_000;
for (let i = 0; i < P / 10; i++) sink += JSON.parse(tick).data.b.length;  // warmup
const p0 = process.hrtime.bigint();
for (let i = 0; i < P; i++) sink += JSON.parse(tick).data.b.length;
const p1 = process.hrtime.bigint();
const nsParse = Number(p1 - p0) / P;
console.log(`\nJSON.parse of a ${tick.length}-byte tick: ${nsParse.toFixed(0)} ns`);
console.log(`→ the opportunity check is ${(nsPerOp / (nsParse + nsPerOp) * 100).toFixed(1)}% of the post-socket message cost (sink ${sink > 0 ? 'ok' : '?'})`);
