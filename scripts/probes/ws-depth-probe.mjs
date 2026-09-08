// WebSocket depth channels of the five venues: connect time, subscribe to first snapshot, levels, and message rate over a window.
// Run from server/: node ../scripts/probes/ws-depth-probe.mjs
// Recorded in docs/research/2026-09-06-venue-depth-endpoints-probe.md.
const WINDOW_MS = 6000;

const venues = [
  {
    id: 'binance depth20@100ms', url: 'wss://fstream.binance.com/public/ws',
    sub: () => [JSON.stringify({ method: 'SUBSCRIBE', params: ['btcusdt@depth20@100ms', 'layerusdt@depth20@100ms'], id: 1 })],
    classify: (j) => j.e === 'depthUpdate' && Array.isArray(j.b) ? { sym: j.s, kind: 'snapshot', bids: j.b.length, asks: j.a.length, sample: { b0: j.b[0], a0: j.a[0], U: j.U, u: j.u, pu: j.pu, E: j.E, T: j.T } } : null,
  },
  {
    id: 'bybit orderbook.50', url: 'wss://stream.bybit.com/v5/public/linear',
    sub: () => [JSON.stringify({ op: 'subscribe', args: ['orderbook.50.BTCUSDT', 'orderbook.50.LAYERUSDT'] })],
    classify: (j) => j.topic?.startsWith('orderbook.') ? { sym: j.data.s, kind: j.type, bids: j.data.b.length, asks: j.data.a.length, sample: { b0: j.data.b[0], a0: j.data.a[0], u: j.data.u, seq: j.data.seq, ts: j.ts, cts: j.cts } } : null,
  },
  {
    id: 'okx books5', url: 'wss://ws.okx.com:8443/ws/v5/public',
    sub: () => [JSON.stringify({ id: 'sub1', op: 'subscribe', args: [{ channel: 'books5', instId: 'BTC-USDT-SWAP' }, { channel: 'books5', instId: 'LAYER-USDT-SWAP' }] })],
    classify: (j) => j.arg?.channel === 'books5' && j.data ? { sym: j.arg.instId, kind: 'snapshot', bids: j.data[0].bids.length, asks: j.data[0].asks.length, sample: { b0: j.data[0].bids[0], a0: j.data[0].asks[0], ts: j.data[0].ts, seqId: j.data[0].seqId } } : null,
  },
  {
    id: 'okx books', url: 'wss://ws.okx.com:8443/ws/v5/public',
    sub: () => [JSON.stringify({ id: 'sub2', op: 'subscribe', args: [{ channel: 'books', instId: 'BTC-USDT-SWAP' }, { channel: 'books', instId: 'LAYER-USDT-SWAP' }] })],
    classify: (j) => j.arg?.channel === 'books' && j.data ? { sym: j.arg.instId, kind: j.action, bids: j.data[0].bids.length, asks: j.data[0].asks.length, sample: { b0: j.data[0].bids[0], a0: j.data[0].asks[0], ts: j.data[0].ts, seqId: j.data[0].seqId, prevSeqId: j.data[0].prevSeqId } } : null,
  },
  {
    id: 'kraken book', url: 'wss://futures.kraken.com/ws/v1',
    sub: () => [JSON.stringify({ event: 'subscribe', feed: 'book', product_ids: ['PF_XBTUSD', 'PF_LAYERUSD'] })],
    classify: (j) => j.feed === 'book_snapshot' ? { sym: j.product_id, kind: 'snapshot', bids: j.bids.length, asks: j.asks.length, sample: { b0: j.bids[0], a0: j.asks[0], seq: j.seq, timestamp: j.timestamp, tickSize: j.tickSize } }
      : j.feed === 'book' && j.product_id ? { sym: j.product_id, kind: 'delta', bids: j.side === 'buy' ? 1 : 0, asks: j.side === 'sell' ? 1 : 0, sample: { side: j.side, price: j.price, qty: j.qty, seq: j.seq } } : null,
  },
  {
    id: 'coinbase level2', url: 'wss://advanced-trade-ws.coinbase.com',
    sub: () => [JSON.stringify({ type: 'subscribe', channel: 'level2', product_ids: ['BTC-PERP-INTX', 'S-PERP-INTX'] }), JSON.stringify({ type: 'subscribe', channel: 'heartbeats' })],
    classify: (j) => j.channel === 'l2_data' ? (() => { const ev = j.events[0]; const up = ev.updates ?? []; return { sym: ev.product_id, kind: ev.type, bids: up.filter((u) => u.side === 'bid').length, asks: up.filter((u) => u.side === 'offer' || u.side === 'ask').length, sample: { u0: up[0], u1: up[1], sides: [...new Set(up.map((u) => u.side))], sequence_num: j.sequence_num, timestamp: j.timestamp } }; })() : null,
  },
];

function run(v) {
  return new Promise((resolve) => {
    const out = { id: v.id, url: v.url, firstSnapshotMs: {}, snapshotLevels: {}, msgs: 0, bytes: 0, kinds: {}, other: [] };
    const t0 = performance.now();
    let tSub = 0;
    let ws;
    try { ws = new WebSocket(v.url); } catch (e) { out.error = String(e); return resolve(out); }
    const done = () => { try { ws.close(); } catch {} resolve(out); };
    const timer = setTimeout(() => { out.windowMs = +(performance.now() - tSub).toFixed(0); done(); }, WINDOW_MS + 3000);
    ws.onopen = () => {
      out.connectMs = +(performance.now() - t0).toFixed(0);
      for (const f of v.sub()) ws.send(f);
      tSub = performance.now();
    };
    ws.onerror = (e) => { out.error = String(e?.message ?? e?.type ?? e); };
    ws.onclose = (e) => { out.closeCode = e.code; clearTimeout(timer); resolve(out); };
    ws.onmessage = (m) => {
      const text = typeof m.data === 'string' ? m.data : Buffer.from(m.data).toString('utf8');
      out.msgs++; out.bytes += text.length;
      if (text === 'pong') return;
      let j; try { j = JSON.parse(text); } catch { return; }
      const c = v.classify(j);
      if (!c) { if (out.other.length < 3) out.other.push(text.slice(0, 200)); return; }
      const key = `${c.sym}:${c.kind}`;
      out.kinds[key] = (out.kinds[key] ?? 0) + 1;
      if (c.kind === 'snapshot' && out.firstSnapshotMs[c.sym] === undefined) {
        out.firstSnapshotMs[c.sym] = +(performance.now() - tSub).toFixed(0);
        out.snapshotLevels[c.sym] = { bids: c.bids, asks: c.asks, bytes: text.length, sample: c.sample };
      }
      if (c.kind !== 'snapshot' && !out.firstDelta) out.firstDelta = { sym: c.sym, kind: c.kind, sample: c.sample };
    };
  });
}

const results = await Promise.all(venues.map(run));
for (const r of results) console.log(JSON.stringify(r));
