// LBank perpetual WebSocket probe on wss://lbkperpws.lbank.com/ws: the topic protocol, the book topic and its snapshot, deltas and batch sequence, the size unit against the REST book, the ticker topic, errors, the subscribe speed limit, a batch of perpetuals on one connection, silence and compression.
// The documentation names the URL and nothing else, so every topic number and field below was found on the wire, see docs/profiles/lbank/websocket.md.
// Public, unauthenticated, read-only. Sockets open with perMessageDeflate false, like server/src/feeds/book/VenueFeed.ts, except in the deflate mode.
// Run from server/: node ../scripts/probes/venues/lbank/ws-probe.mjs [book|quiet|errors|speed|batch|silence|deflate]
//   book     topic 25 on four perpetuals, topic 7 on two, topic 18 and topic 2 on one, then a REST book compare, about 45 s
//   quiet    topic 25 on three quieter perpetuals with the REST touch read every 2.5 s beside the socket book, about 32 s
//   errors   unknown symbols and topics, bad filters, text that is not JSON, pings, unsubscribe, a suspended contract, the URL with its query, then one trimmed book snapshot and delta, about 16 s
//   speed    twenty subscribe frames at once then one every 250 ms for 3 s, then twenty-five at once on a second socket, about 10 s
//   batch    topic 25 on 100 perpetuals on one connection, subscribed at 10 a second, held 25 s in all
//   silence  one socket for 60 s, subscribed to a quiet ticker, that never sends a frame of its own
//   deflate  offers permessage-deflate once and prints what the server negotiates, about 3 s
// Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/lbank/websocket.md.
import { createRequire } from 'node:module';
import { appendFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(new URL('../../../../server/package.json', import.meta.url));
const WebSocket = require('ws');

const URL_DOC = 'wss://lbkperpws.lbank.com/ws';
const URL_QUERY = 'wss://lbkperpws.lbank.com/ws?version=1.0.0'; // what a third party scraper uses
const REST = 'https://lbkperp.lbank.com/cfd/openApi/v1/pub';
const TOPIC_BOOK = '25';
const TOPIC_TICKER = '7';
const TOPIC_FULL_BOOK = '18';
const TOPIC_TRADES = '2';
const OUT = process.env.PROBE_OUT_DIR;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (tag, obj) => console.log(JSON.stringify({ tag, ...obj }));

let localNo = 0;
const subFrame = (topic, filter, action = '1') =>
  JSON.stringify({ SendTopicAction: { Action: action, LocalNo: ++localNo, TopicID: topic, FilterValue: filter, ResumeNo: -1 } });

function capture(name, text) {
  if (!OUT) return;
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, name);
  if (existsSync(file) && statSync(file).size > 5e6) return; // keep captures small, /tmp is RAM
  appendFileSync(file, text + '\n');
}

function open(url = URL_DOC, opts = { perMessageDeflate: false }) {
  const t0 = Date.now();
  const ws = new WebSocket(url, opts);
  ws.t0 = t0;
  ws.pings = 0;
  ws.on('ping', () => ws.pings++);
  return new Promise((resolve, reject) => {
    ws.once('upgrade', (res) => (ws.upgradeHeaders = res.headers));
    ws.once('open', () => {
      ws.openMs = Date.now() - t0;
      resolve(ws);
    });
    ws.once('unexpected-response', (req, res) => reject(new Error(`http ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return { n: 0 };
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, min: s[0], median: q(0.5), p90: q(0.9), max: s.at(-1) };
}

const isBookDelta = (j) => j.action === 'PushMarketOrder' && j.bNo !== undefined;
const isBookSnapshot = (j) => j.action === 'PushMarketOrder' && j.bNo === undefined;
const rowsOf = (j) => (j.result ?? []).map((r) => r.data);

class Book {
  bids = new Map();
  asks = new Map();
  reset(rows) {
    this.bids.clear();
    this.asks.clear();
    this.apply(rows);
  }
  apply(rows) {
    for (const r of rows) {
      const side = r.Direction === '0' ? this.bids : this.asks;
      const v = Number(r.Volume);
      if (v === 0) side.delete(r.Price);
      else side.set(r.Price, v);
    }
  }
  best() {
    const b = [...this.bids.keys()].map(Number);
    const a = [...this.asks.keys()].map(Number);
    return { bid: b.length ? Math.max(...b) : undefined, ask: a.length ? Math.min(...a) : undefined };
  }
  sorted(side, n) {
    const m = side === 'bids' ? this.bids : this.asks;
    const keys = [...m.keys()].sort((x, y) => (side === 'bids' ? Number(y) - Number(x) : Number(x) - Number(y)));
    return keys.slice(0, n).map((k) => [Number(k), m.get(k)]);
  }
}

async function book() {
  const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'DOGEUSDT', 'CTKUSDT'];
  const ws = await open();
  log('open', { url: URL_DOC, ms: ws.openMs, server: ws.upgradeHeaders.server, cfRay: ws.upgradeHeaders['cf-ray'] });
  const books = Object.fromEntries(SYMBOLS.map((s) => [s, new Book()]));
  const per = Object.fromEntries(SYMBOLS.map((s) => [s, { snapshots: 0, snapshotLevels: [], snapshotOrdered: [], deltaFrames: 0, arrivals: [], rows: 0, zeroRows: 0, crossedAfter: 0, maxBids: 0, maxAsks: 0, deltaOrdered: 0, deltaUnordered: 0, repeats: 0 }]));
  const acks = [];
  const actions = {};
  const bNos = [];
  const bNoFrames = new Map();
  const bNoByIndex = {};
  const indexField = {};
  const tick = {};
  const parseUs = [];
  let bytes = 0;
  let frames = 0;
  let otherRows = 0;
  let foreignInstruments = new Set();
  const full = { frames: 0, rows: [], arrivals: [], instruments: new Set(), changeType: {} };
  let trades = 0;
  const firstOf = {};

  ws.on('message', (data) => {
    const now = Date.now() - ws.t0;
    bytes += data.length;
    frames++;
    const text = data.toString();
    const p0 = performance.now();
    const j = JSON.parse(text);
    parseUs.push((performance.now() - p0) * 1000);
    capture('book.jsonl', `${now}\t${text}`);
    actions[j.action || '(empty)'] = (actions[j.action || '(empty)'] ?? 0) + 1;
    if (!firstOf[j.action]) firstOf[j.action] = text.slice(0, 600);

    if (j.action === 'RecvTopicAction') {
      acks.push({ t: now, errorCode: j.errorCode, errorMsg: j.errorMsg, data: j.result?.[0]?.data });
      return;
    }
    if (isBookSnapshot(j)) {
      const rows = rowsOf(j);
      const s = rows[0]?.InstrumentID ?? j.errorMsg?.split('_')[1];
      if (!per[s]) return;
      per[s].snapshots++;
      const bp = rows.filter((r) => r.Direction === '0').map((r) => Number(r.Price));
      const ap = rows.filter((r) => r.Direction === '1').map((r) => Number(r.Price));
      per[s].snapshotLevels.push(`${bp.length}/${ap.length}`);
      per[s].snapshotOrdered.push(bp.every((v, i) => i === 0 || bp[i - 1] > v) && ap.every((v, i) => i === 0 || ap[i - 1] < v));
      per[s].snapshotAt ??= now;
      books[s].reset(rows);
      return;
    }
    if (isBookDelta(j)) {
      bNos.push(j.bNo);
      (bNoByIndex[j.index] ??= []).push(j.bNo);
      bNoFrames.set(j.bNo, (bNoFrames.get(j.bNo) ?? 0) + 1);
      indexField[j.index] = (indexField[j.index] ?? 0) + 1;
      const rows = rowsOf(j);
      const bySym = {};
      for (const r of rows) {
        if (per[r.InstrumentID]) (bySym[r.InstrumentID] ??= []).push(r);
        else {
          otherRows++;
          foreignInstruments.add(r.InstrumentID);
        }
      }
      if (bNoFrames.get(j.bNo) > 1) return; // the same batch delivered again for another subscription
      for (const [s, rs] of Object.entries(bySym)) {
        const p = per[s];
        p.deltaFrames++;
        p.arrivals.push(now);
        p.rows += rs.length;
        p.zeroRows += rs.filter((r) => Number(r.Volume) === 0).length;
        const bp = rs.filter((r) => r.Direction === '0').map((r) => Number(r.Price));
        const ap = rs.filter((r) => r.Direction === '1').map((r) => Number(r.Price));
        const ordered = bp.every((v, i) => i === 0 || bp[i - 1] >= v) && ap.every((v, i) => i === 0 || ap[i - 1] <= v);
        if (ordered) p.deltaOrdered++;
        else p.deltaUnordered++;
        const before = JSON.stringify([...books[s].bids].concat([...books[s].asks]));
        books[s].apply(rs);
        if (JSON.stringify([...books[s].bids].concat([...books[s].asks])) === before) p.repeats++;
        const { bid, ask } = books[s].best();
        if (bid !== undefined && ask !== undefined && bid >= ask) p.crossedAfter++;
        p.maxBids = Math.max(p.maxBids, books[s].bids.size);
        p.maxAsks = Math.max(p.maxAsks, books[s].asks.size);
      }
      return;
    }
    if (j.action === 'PushDelayMarketOrder') {
      const rows = rowsOf(j);
      full.frames++;
      full.rows.push(rows.length);
      full.arrivals.push(now);
      rows.forEach((r) => full.instruments.add(r.InstrumentID));
      full.changeType[j.changeType] = (full.changeType[j.changeType] ?? 0) + 1;
      return;
    }
    if (j.action === 'PushMarketDataOverView') {
      for (const d of rowsOf(j)) {
        const t = (tick[d.InstrumentID] ??= { n: 0, ages: [], last: null, fields: Object.keys(d), indexChanges: 0, markChanges: 0, rateChanges: 0 });
        t.n++;
        if (t.last) {
          if (t.last.UnderlyingPrice !== d.UnderlyingPrice) t.indexChanges++;
          if (t.last.MarkedPrice !== d.MarkedPrice) t.markChanges++;
          if (t.last.PositionFeeRate !== d.PositionFeeRate) t.rateChanges++;
        }
        t.ages.push(Math.round(Date.now() / 1000 - Number(d.UpdateTime)));
        t.last = d;
      }
      return;
    }
    if (j.action === 'PushMarketTrade') trades++;
  });

  for (const s of SYMBOLS) {
    ws.send(subFrame(TOPIC_BOOK, `Exchange_${s}`));
    await sleep(300);
  }
  ws.send(subFrame(TOPIC_TICKER, 'Exchange_BTCUSDT'));
  await sleep(300);
  ws.send(subFrame(TOPIC_TICKER, 'Exchange_CTKUSDT'));
  await sleep(300);
  ws.send(subFrame(TOPIC_FULL_BOOK, 'Exchange_XRPUSDT')); // not a book symbol here, since this topic also opens with a two level PushMarketOrder
  await sleep(300);
  ws.send(subFrame(TOPIC_TRADES, 'Exchange_BTCUSDT'));
  await sleep(40_000);

  const rest = {};
  for (const s of SYMBOLS) {
    const t0 = Date.now();
    const r = await (await fetch(`${REST}/marketOrder?symbol=${s}&depth=50`)).json();
    rest[s] = { at: t0, data: r.data };
  }
  const md = await (await fetch(`${REST}/marketData?productGroup=SwapU`)).json();
  ws.terminate();

  log('acks', { acks: acks.map((a) => `${a.data?.LocalNo}:${a.data?.TopicID}:${a.data?.FilterValue}:${a.errorCode}:${a.errorMsg}`) });
  log('actions', actions);
  for (const [a, f] of Object.entries(firstOf)) log('first_frame', { action: a, text: f });
  log('throughput', { frames, bytes, seconds: 42, framesPerS: Math.round(frames / 42), bytesPerS: Math.round(bytes / 42), parseUs: stats(parseUs.map((x) => Math.round(x))) });
  const sortedB = [...bNos];
  log('bNo', {
    deltaFrames: bNos.length,
    distinct: bNoFrames.size,
    deliveredMoreThanOnce: [...bNoFrames.values()].filter((n) => n > 1).length,
    increasing: bNos.every((v, i) => i === 0 || v >= bNos[i - 1]),
    steps: stats(sortedB.slice(1).map((v, i) => v - sortedB[i])),
    indexField,
    perIndex: Object.fromEntries(Object.entries(bNoByIndex).map(([k, v]) => [k, { frames: v.length, increasing: v.every((x, i) => i === 0 || x > v[i - 1]), first: v[0], last: v.at(-1) }])),
  });
  log('foreign_rows', { rows: otherRows, instruments: foreignInstruments.size, sample: [...foreignInstruments].slice(0, 12) });
  for (const s of SYMBOLS) {
    const p = per[s];
    const gaps = p.arrivals.slice(1).map((v, i) => v - p.arrivals[i]);
    const b = books[s];
    const r = rest[s].data;
    const cmp = (side, restRows) => {
      const mine = b.sorted(side, 20);
      let priceEq = 0;
      let sizeEq = 0;
      restRows.slice(0, 20).forEach((x, i) => {
        if (mine[i] && mine[i][0] === Number(x.price)) {
          priceEq++;
          if (mine[i][1] === Number(x.volume)) sizeEq++;
        }
      });
      return { priceEq, sizeEq, of: Math.min(20, restRows.length) };
    };
    log('book_symbol', {
      symbol: s,
      snapshots: p.snapshots,
      snapshotLevels: p.snapshotLevels,
      snapshotOrdered: p.snapshotOrdered,
      snapshotAtMs: p.snapshotAt,
      deltaFrames: p.deltaFrames,
      frameGapMs: stats(gaps),
      rows: p.rows,
      zeroRows: p.zeroRows,
      deltaOrdered: p.deltaOrdered,
      deltaUnordered: p.deltaUnordered,
      noChangeFrames: p.repeats,
      crossedAfterApply: p.crossedAfter,
      maxLevelsHeld: `${p.maxBids}/${p.maxAsks}`,
      best: b.best(),
      restTop: { bid: r?.bids?.[0], ask: r?.asks?.[0], bids: r?.bids?.length, asks: r?.asks?.length },
      restVsSocketTop20: { bids: cmp('bids', r?.bids ?? []), asks: cmp('asks', r?.asks ?? []) },
    });
  }
  log('full_book_topic', { frames: full.frames, rows: stats(full.rows), gapsMs: stats(full.arrivals.slice(1).map((v, i) => v - full.arrivals[i])), instruments: full.instruments.size, changeType: full.changeType });
  for (const [s, t] of Object.entries(tick)) {
    const m = md.data.find((x) => x.symbol === s);
    log('ticker', { symbol: s, frames: t.n, indexChanges: t.indexChanges, markChanges: t.markChanges, rateChanges: t.rateChanges, updateTimeAgeS: stats(t.ages), fields: t.fields, last: { index: t.last.UnderlyingPrice, mark: t.last.MarkedPrice, rate: t.last.PositionFeeRate, preRate: t.last.PrePositionFeeRate, status: t.last.InstrumentStatus }, rest: { index: m?.underlyingPrice, mark: m?.markedPrice, rate: m?.fundingRate } });
  }
  log('trades', { frames: trades });
  log('server_pings', { n: ws.pings });
}

async function errors() {
  const ws = await open();
  const replies = [];
  ws.on('message', (data) => {
    const text = data.toString();
    if (!text.startsWith('{')) {
      replies.push({ t: Date.now() - ws.t0, text: `text frame: ${text.slice(0, 80)}` });
      return;
    }
    const j = JSON.parse(text);
    if (j.action === 'PushKLine') return;
    const now = Date.now() - ws.t0;
    const rows = rowsOf(j);
    replies.push({ t: now, text: !j.action?.startsWith('Push') ? text.slice(0, 400) : `${j.action} rows=${rows.length} index=${j.index ?? j.errorMsg} first=${JSON.stringify(rows[0] ?? null).slice(0, 160)}` });
  });
  ws.on('close', (code, reason) => replies.push({ t: Date.now() - ws.t0, text: `close ${code} ${reason}` }));
  const steps = [
    ['book_unknown_symbol', subFrame(TOPIC_BOOK, 'Exchange_NOPEUSDT')],
    ['ticker_unknown_symbol', subFrame(TOPIC_TICKER, 'Exchange_NOPEUSDT')],
    ['unknown_topic', subFrame('99', 'Exchange_BTCUSDT')],
    ['book_filter_without_exchange', subFrame(TOPIC_BOOK, 'BTCUSDT')],
    ['book_lowercase_symbol', subFrame(TOPIC_BOOK, 'Exchange_btcusdt')],
    ['book_suspended_contract', subFrame(TOPIC_BOOK, 'Exchange_COCOAUSDT')],
    ['private_topic', subFrame('3', 'Exchange_BTCUSDT')],
    ['ticker_ctk', subFrame(TOPIC_TICKER, 'Exchange_CTKUSDT')],
    ['ticker_ctk_again', subFrame(TOPIC_TICKER, 'Exchange_CTKUSDT')],
    ['not_json', 'hello'],
    ['text_ping', 'ping'],
    ['json_ping', JSON.stringify({ action: 'ping', ping: 'probe' })],
    ['unknown_action', subFrame(TOPIC_TICKER, 'Exchange_CTKUSDT', '5')],
    ['ticker_ctk_unsubscribe', subFrame(TOPIC_TICKER, 'Exchange_CTKUSDT', '0')],
  ];
  for (const [name, frame] of steps) {
    replies.push({ t: Date.now() - ws.t0, text: `>>> ${name} ${frame.slice(0, 160)}` });
    if (ws.readyState === ws.OPEN) ws.send(frame);
    await sleep(500);
  }
  ws.on('pong', (d) => replies.push({ t: Date.now() - ws.t0, text: `protocol pong ${d.toString()}` }));
  replies.push({ t: Date.now() - ws.t0, text: '>>> protocol ping probe' });
  ws.ping('probe');
  await sleep(3000);
  ws.terminate();
  for (const r of replies) log('reply', r);

  // One snapshot and one delta of the book topic, trimmed to their first rows, for the profile's captured frames.
  const b = await open();
  const trimmed = {};
  b.on('message', (d) => {
    const text = d.toString();
    if (!text.startsWith('{')) return;
    const j = JSON.parse(text);
    const kind = isBookSnapshot(j) ? 'snapshot' : isBookDelta(j) ? 'delta' : j.action === 'RecvTopicAction' ? 'ack' : null;
    if (!kind || trimmed[kind]) return;
    const rows = j.result ?? [];
    const keep = kind === 'delta' ? rows.filter((r) => r.data.InstrumentID === 'BTCUSDT').slice(0, 3).concat(rows.filter((r) => r.data.InstrumentID !== 'BTCUSDT').slice(0, 1)) : kind === 'snapshot' ? rows.filter((r) => r.data.Direction === '0').slice(0, 2).concat(rows.filter((r) => r.data.Direction === '1').slice(0, 2)) : rows;
    trimmed[kind] = { rowsInFrame: rows.length, frame: { ...j, result: keep } };
  });
  b.send(subFrame(TOPIC_BOOK, 'Exchange_BTCUSDT'));
  await sleep(2500);
  b.terminate();
  for (const [kind, v] of Object.entries(trimmed)) log('book_frame', { kind, rowsInFrame: v.rowsInFrame, frame: JSON.stringify(v.frame) });

  let n = 0;
  const q = await open(URL_QUERY);
  q.on('message', (d) => {
    if (!d.toString().startsWith('{')) return;
    const j = JSON.parse(d.toString());
    if (j.action === 'PushMarketDataOverView' || j.action === 'RecvTopicAction') n++;
  });
  q.send(subFrame(TOPIC_TICKER, 'Exchange_BTCUSDT'));
  await sleep(2000);
  q.terminate();
  log('url_with_query', { url: URL_QUERY, openMs: q.openMs, ackOrTickerFrames: n });
}

async function speed() {
  const syms = (await (await fetch(`${REST}/instrument?productGroup=SwapU`)).json()).data.map((r) => r.symbol).slice(0, 70);
  const run = async (label, batches) => {
    const ws = await open();
    const sentAt = new Map();
    const out = { ok: [], speed: [], other: {}, close: null };
    ws.on('message', (d) => {
      const text = d.toString();
      if (!text.startsWith('{')) return;
      const j = JSON.parse(text);
      if (j.action === 'RecvTopicAction') {
        const no = Number(j.result?.[0]?.data?.LocalNo);
        if (j.errorCode === 0) out.ok.push(sentAt.get(no));
        else out.other[j.errorMsg] = (out.other[j.errorMsg] ?? 0) + 1;
      } else if (/Max Speed/.test(j.errorMsg ?? '')) out.speed.push(`${Date.now() - ws.t0}:${j.errorMsg}`);
    });
    ws.on('close', (c) => (out.close = `${c} at ${Date.now() - ws.t0} ms`));
    let i = 0;
    const t0 = Date.now();
    for (const [n, waitAfter] of batches) {
      for (let k = 0; k < n; k++) {
        if (ws.readyState !== ws.OPEN) break;
        ws.send(subFrame(TOPIC_TICKER, `Exchange_${syms[i++]}`));
        sentAt.set(localNo, Date.now() - t0);
      }
      await sleep(waitAfter);
    }
    await sleep(800);
    ws.terminate();
    const okAfterBurst = out.ok.filter((t) => t > 50).sort((a, b) => a - b);
    log('speed', { label, sent: i, acked: out.ok.length, ackedSendTimesAfterBurstMs: okAfterBurst, otherErrors: out.other, overSpeed: out.speed.length, overSpeedSample: out.speed.slice(0, 2), closedByServer: out.close });
  };
  await run('20_at_once_then_1_every_250ms_for_3s', [[20, 250], ...Array.from({ length: 12 }, () => [1, 250])]);
  await run('25_at_once', [[25, 3000]]);
}

async function batch() {
  const md = (await (await fetch(`${REST}/marketData?productGroup=SwapU`)).json()).data;
  const ranked = md.sort((a, b) => Number(b.turnover) - Number(a.turnover)).map((r) => r.symbol);
  const chosen = ranked.filter((_, i) => i % 8 === 0).slice(0, 100);
  const set = new Set(chosen);
  const ws = await open();
  let acked = 0;
  const failed = {};
  const snap = new Set();
  const deltaSyms = new Set();
  let frames = 0;
  let bytes = 0;
  let deltaFrames = 0;
  let rows = 0;
  let ownRows = 0;
  const bNoCount = new Map();
  const parseUs = [];
  const perSecond = new Map();
  let subscribedAt = 0;
  ws.on('message', (d) => {
    frames++;
    bytes += d.length;
    const sec = Math.floor((Date.now() - ws.t0) / 1000);
    perSecond.set(sec, (perSecond.get(sec) ?? 0) + 1);
    const p0 = performance.now();
    const j = JSON.parse(d.toString());
    parseUs.push((performance.now() - p0) * 1000);
    if (j.action === 'RecvTopicAction') {
      if (j.errorCode === 0) acked++;
      else failed[`${j.errorCode}:${j.errorMsg}`] = (failed[`${j.errorCode}:${j.errorMsg}`] ?? 0) + 1;
    } else if (isBookSnapshot(j)) {
      const s = rowsOf(j)[0]?.InstrumentID;
      if (s) snap.add(s);
    } else if (isBookDelta(j)) {
      deltaFrames++;
      bNoCount.set(j.bNo, (bNoCount.get(j.bNo) ?? 0) + 1);
      for (const r of rowsOf(j)) {
        rows++;
        if (set.has(r.InstrumentID)) {
          ownRows++;
          deltaSyms.add(r.InstrumentID);
        }
      }
    } else if (/Max Speed/.test(j.errorMsg ?? '')) failed[j.errorMsg] = (failed[j.errorMsg] ?? 0) + 1;
  });
  let close = null;
  ws.on('close', (c) => (close = `${c} at ${Date.now() - ws.t0} ms`));
  for (const s of chosen) {
    if (ws.readyState === ws.OPEN) ws.send(subFrame(TOPIC_BOOK, `Exchange_${s}`));
    await sleep(100);
  }
  subscribedAt = Date.now() - ws.t0;
  await sleep(15_000);
  ws.terminate();
  const steady = [...perSecond.entries()].filter(([s]) => s * 1000 > subscribedAt + 1000 && s < 25).map(([, n]) => n);
  log('batch', {
    markets: chosen.length,
    subscribedAtMs: subscribedAt,
    acked,
    failed,
    snapshots: snap.size,
    missingSnapshots: chosen.filter((s) => !snap.has(s)).slice(0, 10),
    symbolsWithDeltas: deltaSyms.size,
    frames,
    deltaFrames,
    distinctBNo: bNoCount.size,
    maxDeliveriesPerBNo: Math.max(0, ...bNoCount.values()),
    rows,
    rowsForSubscribed: ownRows,
    bytesPerS: Math.round(bytes / 25),
    bytesPerFrame: Math.round(bytes / frames),
    framesPerSecondAfterSubscribe: stats(steady),
    parseUs: stats(parseUs.map((x) => Math.round(x))),
    closedByServer: close,
  });
}

async function silence() {
  const quiet = 'HK50USDT';
  const ws = await open();
  const res = { frames: 0, lastFrameMs: null, close: null };
  ws.on('message', () => {
    res.frames++;
    res.lastFrameMs = Date.now() - ws.t0;
  });
  ws.on('close', (c, r) => (res.close = `${c} ${r} at ${Date.now() - ws.t0} ms`));
  ws.send(subFrame(TOPIC_TICKER, `Exchange_${quiet}`));
  await sleep(60_000);
  log('silence', { name: 'quiet_ticker_no_client_frames', ...res, serverPings: ws.pings, stillOpen: ws.readyState === ws.OPEN });
  ws.terminate();
}

async function deflate() {
  const ws = await open(URL_DOC, { perMessageDeflate: true });
  log('deflate', { offered: true, negotiated: ws.upgradeHeaders['sec-websocket-extensions'] ?? null, openMs: ws.openMs });
  let first;
  ws.on('message', (d, isBinary) => (first ??= { isBinary, bytes: d.length, text: d.toString().slice(0, 120) }));
  ws.send(subFrame(TOPIC_TICKER, 'Exchange_BTCUSDT'));
  await sleep(2000);
  log('deflate_first_frame', first ?? {});
  ws.terminate();
}

async function quiet() {
  const SYMBOLS = ['CTKUSDT', 'HK50USDT', 'STORJUSDT'];
  const ws = await open();
  const books = Object.fromEntries(SYMBOLS.map((s) => [s, new Book()]));
  const seen = Object.fromEntries(SYMBOLS.map((s) => [s, { snapshot: null, deltaFrames: 0, rows: 0, firstDeltaBNo: null }]));
  let lastBNo = null;
  ws.on('message', (d) => {
    const text = d.toString();
    capture('quiet.jsonl', `${Date.now() - ws.t0}\t${text}`);
    const j = JSON.parse(text);
    if (isBookSnapshot(j)) {
      const rows = rowsOf(j);
      const s = rows[0]?.InstrumentID;
      if (!books[s]) return;
      books[s].reset(rows);
      seen[s].snapshot = { atMs: Date.now() - ws.t0, levels: `${rows.filter((r) => r.Direction === '0').length}/${rows.filter((r) => r.Direction === '1').length}`, lastBNo };
    } else if (isBookDelta(j)) {
      lastBNo = j.bNo;
      const bySym = {};
      for (const r of rowsOf(j)) if (books[r.InstrumentID]) (bySym[r.InstrumentID] ??= []).push(r);
      for (const [s, rs] of Object.entries(bySym)) {
        seen[s].deltaFrames++;
        seen[s].rows += rs.length;
        seen[s].firstDeltaBNo ??= { bNo: j.bNo, index: j.index, atMs: Date.now() - ws.t0 };
        books[s].apply(rs);
      }
    }
  });
  for (const s of SYMBOLS) {
    ws.send(subFrame(TOPIC_BOOK, `Exchange_${s}`));
    await sleep(300);
  }
  const checks = Object.fromEntries(SYMBOLS.map((s) => [s, { same: 0, differ: 0, samples: [] }]));
  for (let i = 0; i < 12; i++) {
    await sleep(2500);
    for (const s of SYMBOLS) {
      const r = (await (await fetch(`${REST}/marketOrder?symbol=${s}&depth=5`)).json()).data;
      const rest = { bid: Number(r?.bids?.[0]?.price), ask: Number(r?.asks?.[0]?.price) };
      const mine = books[s].best();
      const same = rest.bid === mine.bid && rest.ask === mine.ask;
      checks[s][same ? 'same' : 'differ']++;
      if (!same && checks[s].samples.length < 3) checks[s].samples.push({ atS: 2.5 * (i + 1), rest, socket: mine });
    }
  }
  ws.terminate();
  for (const s of SYMBOLS) log('quiet_symbol', { symbol: s, ...seen[s], touchVsRestEvery2500ms: checks[s] });
}

const mode = process.argv[2] ?? 'book';
const modes = { book, quiet, errors, speed, batch, silence, deflate };
if (!modes[mode]) {
  console.error(`unknown mode ${mode}, use one of ${Object.keys(modes).join(', ')}`);
  process.exit(1);
}
log('start', { mode, at: new Date().toISOString() });
await modes[mode]();
log('end', { at: new Date().toISOString() });
