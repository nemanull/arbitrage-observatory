// Full universe load: the layer 1 channels the feeds use today, then the depth channels, each for one window across every live perpetual on the five venues.
// Prints per venue message rate, bytes, JSON.parse time, snapshot coverage and first snapshot latency, plus process CPU and event loop delay per run.
// Run from server/: node ../scripts/probes/ws-depth-load-probe.mjs [windowSeconds]
// Recorded in docs/research/2026-09-06-venue-depth-endpoints-probe.md.
import { monitorEventLoopDelay } from 'node:perf_hooks';

const WINDOW_MS = (Number(process.argv[2]) || 20) * 1000;
const SETTLE_MS = 4000; // after the last subscribe frame, before the window starts

const json = async (url) => (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();

async function universe() {
  const out = {};
  const b = await json('https://fapi.binance.com/fapi/v1/exchangeInfo');
  out.binance = b.symbols.filter((s) => s.contractType === 'PERPETUAL' && s.status === 'TRADING').map((s) => s.symbol);
  let cursor = '', bybit = [];
  do {
    const r = await json(`https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    bybit.push(...r.result.list.filter((i) => i.status === 'Trading' && i.contractType === 'LinearPerpetual').map((i) => i.symbol));
    cursor = r.result.nextPageCursor;
  } while (cursor);
  out.bybit = bybit;
  const o = await json('https://www.okx.com/api/v5/public/instruments?instType=SWAP');
  out.okx = o.data.filter((i) => i.state === 'live').map((i) => i.instId);
  const k = await json('https://futures.kraken.com/derivatives/api/v3/instruments');
  out.krakenfutures = k.instruments.filter((i) => i.tradeable && i.symbol.startsWith('PF_')).map((i) => i.symbol);
  try {
    const c = await json('https://api.coinbase.com/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL');
    out.coinbase = (c.products ?? []).filter((p) => p.product_id.endsWith('-INTX') && p.status !== 'offline').map((p) => p.product_id);
  } catch (e) { out.coinbase = ['BTC-PERP-INTX', 'ETH-PERP-INTX', 'SOL-PERP-INTX']; out.coinbaseNote = String(e.message); }
  return out;
}

const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };

// Each plan: connections of `per` symbols, subscribe frames per `frame` symbols, classify(json) returns {sym, snapshot:boolean} for data frames or null.
function plans(u, mode) {
  const L1 = mode === 'l1';
  return [
    { venue: 'binance', url: 'wss://fstream.binance.com/public/ws', symbols: u.binance, per: 200, frame: 100,
      sub: (s, i) => JSON.stringify({ method: 'SUBSCRIBE', params: s.map((x) => `${x.toLowerCase()}@${L1 ? 'bookTicker' : 'depth20@100ms'}`), id: i + 1 }),
      classify: (j) => (L1 ? (typeof j.b === 'string' ? { sym: j.s, snapshot: true } : null) : (j.e === 'depthUpdate' ? { sym: j.s, snapshot: true } : null)) },
    { venue: 'bybit', url: 'wss://stream.bybit.com/v5/public/linear', symbols: u.bybit, per: 200, frame: 200,
      sub: (s) => JSON.stringify({ op: 'subscribe', args: s.map((x) => `orderbook.${L1 ? 1 : 50}.${x}`) }),
      classify: (j) => (j.topic?.startsWith('orderbook.') ? { sym: j.data.s, snapshot: j.type === 'snapshot' } : null) },
    { venue: 'okx', url: 'wss://ws.okx.com:8443/ws/v5/public', symbols: u.okx, per: 250, frame: 200, stagger: 400,
      sub: (s, i) => JSON.stringify({ id: `s${i}`, op: 'subscribe', args: s.map((x) => ({ channel: L1 ? 'bbo-tbt' : 'books', instId: x })) }),
      classify: (j) => (j.arg && Array.isArray(j.data) ? { sym: j.arg.instId, snapshot: L1 ? true : j.action === 'snapshot' } : null) },
    { venue: 'krakenfutures', url: 'wss://futures.kraken.com/ws/v1', symbols: u.krakenfutures, per: 100, frame: 100,
      sub: (s) => JSON.stringify({ event: 'subscribe', feed: L1 ? 'ticker' : 'book', product_ids: s }),
      classify: (j) => (L1 ? (j.feed === 'ticker' && j.product_id ? { sym: j.product_id, snapshot: true } : null) : (j.feed === 'book_snapshot' ? { sym: j.product_id, snapshot: true } : j.feed === 'book' && j.product_id ? { sym: j.product_id, snapshot: false } : null)) },
    { venue: 'coinbase', url: 'wss://advanced-trade-ws.coinbase.com', symbols: u.coinbase, per: 100, frame: 100,
      sub: (s) => JSON.stringify({ type: 'subscribe', channel: L1 ? 'ticker' : 'level2', product_ids: s }),
      extra: JSON.stringify({ type: 'subscribe', channel: 'heartbeats' }),
      classify: (j) => (j.channel === 'ticker' ? { sym: j.events?.[0]?.tickers?.[0]?.product_id, snapshot: true } : j.channel === 'l2_data' ? { sym: j.events?.[0]?.product_id, snapshot: j.events?.[0]?.type === 'snapshot' } : null) },
  ];
}

async function runMode(u, mode) {
  const hist = monitorEventLoopDelay({ resolution: 5 });
  const stats = {};
  const sockets = [];
  let lastSubscribeAt = 0;
  const openAll = plans(u, mode).map(async (p) => {
    const st = stats[p.venue] = { symbols: p.symbols.length, connections: 0, msgs: 0, bytes: 0, parseMs: 0, data: 0, snapshots: 0, deltas: 0, seen: new Set(), firstSnapshotMs: [], errors: 0, closes: 0, control: [] };
    st.window = { msgs: 0, bytes: 0, parseMs: 0, data: 0 };
    const groups = chunk(p.symbols, p.per);
    for (let gi = 0; gi < groups.length; gi++) {
      if (p.stagger && gi > 0) await new Promise((f) => setTimeout(f, p.stagger));
      const g = groups[gi];
      await new Promise((resolve) => {
        const ws = new WebSocket(p.url);
        sockets.push(ws);
        st.connections++;
        let subAt = 0;
        ws.onopen = () => {
          chunk(g, p.frame).forEach((s, i) => ws.send(p.sub(s, i)));
          if (p.extra) ws.send(p.extra);
          subAt = performance.now();
          lastSubscribeAt = Math.max(lastSubscribeAt, subAt);
          resolve();
        };
        ws.onerror = () => { st.errors++; resolve(); };
        ws.onclose = (e) => { st.closes++; st.control.length < 3 && st.control.push(`close ${e.code}`); resolve(); };
        ws.onmessage = (m) => {
          const text = typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8');
          st.msgs++; st.bytes += text.length;
          if (st.inWindow) { st.window.msgs++; st.window.bytes += text.length; }
          if (text === 'pong') return;
          const t0 = performance.now();
          let j; try { j = JSON.parse(text); } catch { return; }
          const dt = performance.now() - t0;
          st.parseMs += dt; if (st.inWindow) st.window.parseMs += dt;
          const c = p.classify(j);
          if (!c || !c.sym) { if (st.control.length < 3) st.control.push(text.slice(0, 120)); return; }
          st.data++; if (st.inWindow) st.window.data++;
          if (c.snapshot) { st.snapshots++; if (!st.seen.has(c.sym)) { st.seen.add(c.sym); st.firstSnapshotMs.push(performance.now() - subAt); } } else st.deltas++;
        };
      });
    }
  });
  await Promise.all(openAll);
  await new Promise((f) => setTimeout(f, SETTLE_MS));
  for (const st of Object.values(stats)) st.inWindow = true;
  hist.enable();
  const cpu0 = process.cpuUsage(); const t0 = performance.now(); const mem0 = process.memoryUsage().rss;
  await new Promise((f) => setTimeout(f, WINDOW_MS));
  const cpu1 = process.cpuUsage(cpu0); const elapsed = performance.now() - t0; const mem1 = process.memoryUsage().rss;
  hist.disable();
  for (const st of Object.values(stats)) st.inWindow = false;
  for (const ws of sockets) { try { ws.close(); } catch {} }
  const sec = elapsed / 1000;
  const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(0); };
  const report = { mode, windowSec: +sec.toFixed(1), cpuPercentOfOneCore: +((cpu1.user + cpu1.system) / 1000 / elapsed * 100).toFixed(1), eventLoopDelayMs: { p50: +(hist.percentile(50) / 1e6).toFixed(1), p99: +(hist.percentile(99) / 1e6).toFixed(1), max: +(hist.max / 1e6).toFixed(1) }, rssMb: { start: +(mem0 / 1048576).toFixed(0), end: +(mem1 / 1048576).toFixed(0) }, venues: {} };
  let totalMsgs = 0, totalBytes = 0, totalParse = 0;
  for (const [v, st] of Object.entries(stats)) {
    totalMsgs += st.window.msgs; totalBytes += st.window.bytes; totalParse += st.window.parseMs;
    report.venues[v] = { symbols: st.symbols, connections: st.connections, errors: st.errors, closes: st.closes, coverage: `${st.seen.size}/${st.symbols}`, msgsPerSec: +(st.window.msgs / sec).toFixed(0), kbPerSec: +(st.window.bytes / 1024 / sec).toFixed(0), avgBytes: st.window.msgs ? +(st.window.bytes / st.window.msgs).toFixed(0) : 0, parseMsPerSec: +(st.window.parseMs / sec).toFixed(1), snapshotsTotal: st.snapshots, deltasTotal: st.deltas, firstSnapshotMs: { p50: q(st.firstSnapshotMs, 0.5), p90: q(st.firstSnapshotMs, 0.9), max: q(st.firstSnapshotMs, 1) }, control: st.control };
  }
  report.total = { msgsPerSec: +(totalMsgs / sec).toFixed(0), kbPerSec: +(totalBytes / 1024 / sec).toFixed(0), parseMsPerSec: +(totalParse / sec).toFixed(1) };
  return report;
}

const u = await universe();
console.log(JSON.stringify({ universe: Object.fromEntries(Object.entries(u).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])) }));
console.log(JSON.stringify(await runMode(u, 'l1')));
await new Promise((f) => setTimeout(f, 3000));
console.log(JSON.stringify(await runMode(u, 'depth')));
process.exit(0);
