# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""LMAX perpetual futures WebSocket probe for docs/profiles/lmax-digital/websocket.md and rest.md.

Public, unauthenticated and read-only, about 3 minutes of wall time and about 6 socket minutes in total.
  1. Market data socket: handshake headers, compression offer, instrument definitions on production and demo.
  2. Unknown symbol, unknown message type and malformed JSON answers.
  3. SNAPSHOT mode at depth 50 on BTCUSDPERP: cadence, level order, depth.
  4. INCREMENTAL mode at depth 50 and 100 ms on every instrument in one subscribe: first frame per symbol, sequence rule, delta actions,
     and a price keyed replay of BTCUSDPERP checked against a SNAPSHOT socket at equal timestamps.
  5. Depth 0 and depth 500 level counts on BTCUSDPERP.
  6. Silence: three sockets that send nothing after their subscribe, watched for heartbeats and closes, then a protocol ping.
  7. Funding rate socket: cadence and fields over 22 s.
Run from the repository root with: uv run scripts/probes/venues/lmax-digital/ws-probe.py
"""

import asyncio
import collections
import json
import time

import websockets

PROD = "wss://market-data.london-perpetual.lmax.com"
DEMO = "wss://market-data.perpetual-demo.lmax.com"
MD = "/v1/marketdata/web-socket"
FUNDING = "/v1/funding-rate/web-socket"


def now():
    return time.time()


def trim(raw, n=600):
    s = raw if isinstance(raw, str) else raw.decode(errors="replace")
    return s if len(s) <= n else s[:n] + f"... ({len(s)} chars)"


async def recv_for(ws, seconds):
    """Collect (arrival time, parsed frame or raw text) for a fixed window."""
    out = []
    end = now() + seconds
    while True:
        left = end - now()
        if left <= 0:
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            break
        try:
            out.append((now(), json.loads(raw), len(raw)))
        except json.JSONDecodeError:
            out.append((now(), raw, len(raw)))
    return out


async def definitions(base, label, offer_deflate):
    print(f"\n== 1. {label} market data socket, instrument definitions, deflate offered: {offer_deflate}")
    kw = {} if offer_deflate else {"compression": None}
    t0 = now()
    async with websockets.connect(base + MD, open_timeout=15, **kw) as ws:
        print(f"handshake ms {round((now() - t0) * 1000)}")
        hdr = ws.response.headers
        print("response headers:", {k: v for k, v in hdr.raw_items() if k.lower() in ("server", "sec-websocket-extensions", "cf-ray", "date")})
        await ws.send(json.dumps({"type": "GET_INSTRUMENT_DEFINITIONS", "symbols": []}))
        frames = await recv_for(ws, 5)
        for _, f, n in frames:
            if isinstance(f, dict) and f.get("type") == "metadata":
                inst = f["instruments"]
                print(f"metadata frame bytes {n}, instruments {len(inst)}")
                print("status counts", dict(collections.Counter(i.get("marketStatus") for i in inst)))
                print("quote counts", dict(collections.Counter(i.get("quoteCurrency") for i in inst)))
                print("contractSize values", sorted({i.get("contractSize") for i in inst}))
                print("fundingRatePremiumPercentage values", sorted({i.get("fundingRatePremiumPercentage") for i in inst}))
                print("tradingBandwidth values", sorted({i.get("tradingBandwidth") for i in inst}))
                print("pythId values", sorted({i.get("pythId") for i in inst}))
                print("field set", sorted({k for i in inst for k in i}))
                for i in sorted(inst, key=lambda x: x["symbol"]):
                    print("  ", i["symbol"], i["baseCurrency"], i["quoteCurrency"], "size", i["contractSize"], "tick", i["tickSize"],
                          "qty", i["orderQuantityIncrement"], "pythPro", i.get("pythProId"), i["marketStatus"])
                if label == "production":
                    print("first instrument verbatim:", json.dumps(inst[0]))
                    return [i["symbol"] for i in inst]
            else:
                print("other frame:", trim(json.dumps(f) if isinstance(f, dict) else f))
    return []


async def errors():
    print("\n== 2. error answers on production")
    async with websockets.connect(PROD + MD, open_timeout=15, compression=None) as ws:
        for label, msg in [
            ("unknown symbol", json.dumps({"type": "SUBSCRIBE", "symbols": ["BTC/USD"], "depth": "50"})),
            ("lowercase symbol", json.dumps({"type": "SUBSCRIBE", "symbols": ["btcusdperp"], "depth": "50"})),
            ("depth 20, not in the enum", json.dumps({"type": "SUBSCRIBE", "symbols": ["ETHUSDPERP"], "depth": "20"})),
            ("unknown type", json.dumps({"type": "PING"})),
            ("malformed JSON", "{not json"),
            ("unsubscribe a symbol never subscribed", json.dumps({"type": "UNSUBSCRIBE", "symbols": ["SOLUSDPERP"]})),
        ]:
            await ws.send(msg)
            frames = await recv_for(ws, 3)
            kinds = [f.get("type") if isinstance(f, dict) else "raw" for _, f, _ in frames]
            print(f"{label}: {len(frames)} frames, types {collections.Counter(kinds)}")
            for _, f, _ in frames:
                if not (isinstance(f, dict) and f.get("type") in ("snapshot", "delta")):
                    print("   ", trim(json.dumps(f) if isinstance(f, dict) else f, 400))
                    break
            if any(isinstance(f, dict) and f.get("type") in ("snapshot", "delta") for _, f, _ in frames):
                await ws.send(json.dumps({"type": "UNSUBSCRIBE", "symbols": ["BTCUSDPERP", "ETHUSDPERP"]}))
                after = await recv_for(ws, 2)
                print("    unsubscribed, then frames in 2 s:", collections.Counter(f.get("type") for _, f, _ in after[1:] if isinstance(f, dict)))
        print("close code", ws.close_code)


def book_shape(f):
    bids = [float(x["price"]) for x in f.get("bids", [])]
    asks = [float(x["price"]) for x in f.get("asks", [])]
    return {
        "bids": len(bids),
        "asks": len(asks),
        "bids_desc": bids == sorted(bids, reverse=True),
        "asks_asc": asks == sorted(asks),
        "best_bid": bids[0] if bids else None,
        "best_ask": asks[0] if asks else None,
    }


async def snapshot_mode():
    print("\n== 3. SNAPSHOT mode, depth 50, BTCUSDPERP, 10 s")
    async with websockets.connect(PROD + MD, open_timeout=15, compression=None) as ws:
        t0 = now()
        await ws.send(json.dumps({"type": "SUBSCRIBE", "symbols": ["BTCUSDPERP"], "depth": "50", "updateType": "SNAPSHOT"}))
        frames = await recv_for(ws, 10)
        snaps = [(t, f, n) for t, f, n in frames if isinstance(f, dict) and f.get("type") == "snapshot"]
        others = [f for _, f, _ in frames if not (isinstance(f, dict) and f.get("type") == "snapshot")]
        for f in others:
            print("non snapshot frame:", trim(json.dumps(f)))
        print(f"snapshots {len(snaps)} in 10 s, first after {round((snaps[0][0] - t0) * 1000) if snaps else None} ms")
        if snaps:
            gaps = [round((b[0] - a[0]) * 1000) for a, b in zip(snaps, snaps[1:])]
            print("arrival gaps ms min/median/max", min(gaps or [0]), sorted(gaps or [0])[len(gaps or [0]) // 2], max(gaps or [0]))
            ts = [s[1].get("timestampMicros") for s in snaps]
            print("timestampMicros type", type(ts[0]).__name__, "first", ts[0])
            print("shape", book_shape(snaps[0][1]), "bytes", snaps[0][2])
            same = sum(1 for a, b in zip(snaps, snaps[1:]) if a[1]["bids"] == b[1]["bids"] and a[1]["asks"] == b[1]["asks"])
            print("consecutive identical snapshots", same, "of", len(snaps) - 1)
            f = snaps[0][1]
            trimmed = dict(f, bids=f["bids"][:2], asks=f["asks"][:2])
            print("snapshot trimmed to two levels:", json.dumps(trimmed))


def levels(book, side, n=10):
    keys = sorted(book[side], reverse=(side == "bids"))[:n]
    return [(k, book[side][k]) for k in keys]


async def snapshot_collector(seconds, out):
    async with websockets.connect(PROD + MD, open_timeout=15, compression=None) as ws:
        await ws.send(json.dumps({"type": "SUBSCRIBE", "symbols": ["BTCUSDPERP"], "depth": "50", "updateType": "SNAPSHOT"}))
        for _, f, _ in await recv_for(ws, seconds):
            if isinstance(f, dict) and f.get("type") == "snapshot":
                book = {"bids": {float(x["price"]): float(x["quantity"]) for x in f["bids"]},
                        "asks": {float(x["price"]): float(x["quantity"]) for x in f["asks"]}}
                out[f["timestampMicros"]] = (levels(book, "bids", 5), levels(book, "asks", 5))


async def incremental_all(symbols):
    seconds = 25
    print(f"\n== 4. INCREMENTAL mode, depth 50, 100 ms, all {len(symbols)} instruments in one subscribe, {seconds} s, beside a SNAPSHOT socket on BTCUSDPERP")
    snaps = {}
    collector = asyncio.create_task(snapshot_collector(seconds + 1, snaps))
    async with websockets.connect(PROD + MD, open_timeout=15, compression=None) as ws:
        t0 = now()
        await ws.send(json.dumps({"type": "SUBSCRIBE", "symbols": symbols, "depth": "50", "updateType": "INCREMENTAL", "updateInterval": "100"}))
        frames = await recv_for(ws, seconds)
    await collector
    first = {}
    seq = collections.defaultdict(list)
    actions = collections.Counter()
    sides = collections.Counter()
    delta_sizes = []
    per_type = collections.Counter()
    delta_example = None
    ack = None
    books = {}
    max_pos = 0
    replay = None
    replayed = {}
    pos_ok = pos_bad = pos_end_ok = pos_end_bad = crossed = 0
    for t, f, n in frames:
        if not isinstance(f, dict):
            per_type["raw"] += 1
            continue
        per_type[f.get("type")] += 1
        if f.get("type") == "subscription":
            ack = f
        sym = f.get("symbol")
        if f.get("type") in ("snapshot", "delta") and sym not in first:
            first[sym] = (f["type"], round((t - t0) * 1000))
        if f.get("type") == "snapshot":
            books[sym] = book_shape(f)
            if "sequenceNumber" in f:
                print("snapshot carries sequenceNumber", f["sequenceNumber"])
            if sym == "BTCUSDPERP":
                replay = {"bids": {float(x["price"]): float(x["quantity"]) for x in f["bids"]},
                          "asks": {float(x["price"]): float(x["quantity"]) for x in f["asks"]}}
        if f.get("type") == "delta":
            seq[sym].append(int(f["sequenceNumber"]))
            delta_sizes.append(len(f["deltaUpdates"]))
            for u in f["deltaUpdates"]:
                actions[u["updateAction"]] += 1
                sides[u["side"]] += 1
                max_pos = max(max_pos, int(u["positionNumber"]))
                if sym == "BTCUSDPERP" and replay is not None:
                    side = "bids" if u["side"] == "BID" else "asks"
                    price, qty = float(u["price"]), float(u["quantity"])
                    if u["updateAction"] == "DELETE":
                        replay[side].pop(price, None)
                    else:
                        replay[side][price] = qty
                        rank = [k for k, _ in levels(replay, side, 100)].index(price) + 1
                        if rank == int(u["positionNumber"]):
                            pos_ok += 1
                        else:
                            pos_bad += 1
            if sym == "BTCUSDPERP" and replay is not None:
                for u in f["deltaUpdates"]:
                    if u["updateAction"] != "DELETE":
                        side = "bids" if u["side"] == "BID" else "asks"
                        ranks = [k for k, _ in levels(replay, side, 100)]
                        price = float(u["price"])
                        if price in ranks and ranks.index(price) + 1 == int(u["positionNumber"]):
                            pos_end_ok += 1
                        else:
                            pos_end_bad += 1
                b, a = levels(replay, "bids", 1), levels(replay, "asks", 1)
                if b and a and b[0][0] >= a[0][0]:
                    crossed += 1
                replayed[f["timestampMicros"]] = (levels(replay, "bids", 5), levels(replay, "asks", 5))
            if delta_example is None and len(f["deltaUpdates"]) >= 2:
                delta_example = f
    print("ack:", json.dumps(ack))
    print("frame types", dict(per_type))
    print("first frame type per symbol", dict(collections.Counter(v[0] for v in first.values())))
    print("symbols with any frame", len(first), "first frame ms range", min(v[1] for v in first.values()) if first else None, max(v[1] for v in first.values()) if first else None)
    empty = [s for s, b in books.items() if b["bids"] == 0 or b["asks"] == 0]
    print("one sided or empty snapshot symbols", empty)
    print("snapshot level counts (bids, asks)", sorted({(b["bids"], b["asks"]) for b in books.values()}), "order ok", all(b["bids_desc"] and b["asks_asc"] for b in books.values()))
    gaps = dups = 0
    starts = {}
    for s, v in seq.items():
        starts[s] = v[0]
        for a, b in zip(v, v[1:]):
            if b == a:
                dups += 1
            elif b != a + 1:
                gaps += 1
    print("deltas", sum(len(v) for v in seq.values()), "symbols with deltas", len(seq), "seq gaps", gaps, "duplicates", dups)
    print("first sequenceNumber per symbol", sorted(set(starts.values())))
    counts = sorted(((len(v), s) for s, v in seq.items()), reverse=True)
    print("deltas per symbol, busiest and quietest", counts[:3], counts[-3:])
    print("delta actions", dict(actions), "sides", dict(sides), "max positionNumber", max_pos)
    print("BTCUSDPERP NEW or CHANGE whose positionNumber equals its rank after replay:", pos_ok, "not equal:", pos_bad)
    if delta_sizes:
        print("updates per delta min/max", min(delta_sizes), max(delta_sizes))
    print("BTCUSDPERP positionNumber equals the rank after the whole delta:", pos_end_ok, "not equal:", pos_end_bad, "crossed replayed books:", crossed)
    snap_ts = sorted(snaps)
    near = same = 0
    for ts, book in replayed.items():
        later = [x for x in snap_ts if 0 <= x - ts <= 40_000]  # the first snapshot stamped within 40 ms after the delta
        if later:
            near += 1
            same += snaps[later[0]] == book
    print(f"BTCUSDPERP replayed top 5 against the next SNAPSHOT within 40 ms: {len(snaps)} snapshots, {len(replayed)} deltas, {near} with a snapshot that close, top 5 equal on {same}")
    if delta_example:
        d = dict(delta_example, deltaUpdates=delta_example["deltaUpdates"][:3])
        print("delta trimmed to three updates:", json.dumps(d))
    return counts[-1][1] if counts else "XAUUSDPERP"


async def depths():
    print("\n== 5. depth 0 and depth 500 on BTCUSDPERP, SNAPSHOT mode")
    for depth in ("0", "500", "1"):
        async with websockets.connect(PROD + MD, open_timeout=15, compression=None) as ws:
            await ws.send(json.dumps({"type": "SUBSCRIBE", "symbols": ["BTCUSDPERP"], "depth": depth}))
            frames = await recv_for(ws, 4)
            snaps = [(f, n) for _, f, n in frames if isinstance(f, dict) and f.get("type") == "snapshot"]
            if snaps:
                print(f"depth {depth}: snapshots {len(snaps)} in 4 s, shape {book_shape(snaps[0][0])}, bytes {snaps[0][1]}")
            else:
                print(f"depth {depth}: no snapshot, frames {[trim(json.dumps(f), 200) for _, f, _ in frames[:2]]}")




async def watch(label, seconds, subscribe, ping_interval):
    async with websockets.connect(PROD + MD, open_timeout=15, compression=None, ping_interval=ping_interval) as ws:
        t0 = now()
        if subscribe:
            await ws.send(json.dumps(subscribe))
        types = collections.Counter()
        last = t0
        max_gap = 0
        closed = None
        while now() - t0 < seconds:
            try:
                raw = await asyncio.wait_for(ws.recv(), seconds - (now() - t0))
            except asyncio.TimeoutError:
                break
            except websockets.ConnectionClosed as e:
                closed = f"after {round(now() - t0, 1)} s, close frame received {e.rcvd}, sent {e.sent}"
                break
            f = json.loads(raw)
            types[f.get("type")] += 1
            max_gap = max(max_gap, now() - last)
            last = now()
            if f.get("type") not in ("snapshot", "delta", "subscription"):
                print(label, "unexpected frame:", trim(raw))
        tail = f"silent for the last {round(now() - last, 1)} s" if closed is None else ""
        pong = ""
        if closed is None:
            t1 = now()
            waiter = await ws.ping()
            await asyncio.wait_for(waiter, 10)
            pong = f", protocol ping answered in {round((now() - t1) * 1000)} ms"
        print(f"{label}: frame types {dict(types)}, max gap between frames {round(max_gap, 2)} s, closed {closed} {tail}{pong}")


async def silence(quiet):
    print(f"\n== 6. silence, three sockets at once for 70 s, the client sends nothing after its subscribe")
    await asyncio.gather(
        watch("a. no subscribe, no pings", 70, None, None),
        watch("b. no subscribe, client protocol ping every 20 s", 70, None, 20),
        watch(f"c. INCREMENTAL depth 50 at 100 ms on the quietest symbol {quiet}, no pings", 70,
              {"type": "SUBSCRIBE", "symbols": [quiet], "depth": "50", "updateType": "INCREMENTAL", "updateInterval": "100"}, None),
    )


async def funding():
    seconds = 22
    print(f"\n== 7. funding rate socket, {seconds} s")
    async with websockets.connect(PROD + FUNDING, open_timeout=15, compression=None) as ws:
        t0 = now()
        frames = await recv_for(ws, seconds)
    by_ts = collections.defaultdict(list)
    fields = set()
    values = collections.defaultdict(set)
    for t, f, n in frames:
        if not isinstance(f, dict):
            print("raw:", trim(f))
            continue
        fields |= set(f)
        by_ts[f.get("timestampMicros")].append((round(t - t0, 2), f.get("symbol")))
        values[f.get("symbol")].add((f.get("creditFundingRatePercentage"), f.get("debitFundingRatePercentage"), f.get("ratePercentage")))
    print("frames", len(frames), "fields", sorted(fields))
    for ts, rows in sorted(by_ts.items(), key=lambda x: x[0] or 0):
        print("timestampMicros", ts, "rows", len(rows), "arrived s", rows[0][0], "to", rows[-1][0])
    print("distinct symbols", len(values), "distinct (credit, debit, ratePercentage) triples", sorted({v for s in values.values() for v in s}))
    nonzero = {s: v for s, v in values.items() if any(x != "0" for t in v for x in t)}
    print("symbols with a nonzero rate", nonzero)
    if frames:
        print("first frame verbatim:", json.dumps(frames[0][1]))
        print("host clock minus timestampMicros of first frame, ms", round(frames[0][0] * 1000 - frames[0][1]["timestampMicros"] / 1000))


async def main():
    started = now()
    symbols = await definitions(PROD, "production", False)
    await definitions(PROD, "production", True)
    await definitions(DEMO, "demo", False)
    await errors()
    await snapshot_mode()
    quiet = await incremental_all(symbols)
    await depths()
    await silence(quiet)
    await funding()
    print(f"\nwall time s {round(now() - started)}")


asyncio.run(main())
