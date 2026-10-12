# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Unocoin futures WebSocket probe for docs/profiles/unocoin/websocket.md.

Public, unauthenticated and read-only.
It opens at most three sockets at once, for about two and a half minutes of wall time.
Mode 1 captures the protocol on one socket: acks, errors, ping, every channel the web app uses, and 14 book channels.
Mode 2 runs Binance USD-M depth20@100ms beside the Unocoin book for BTC and ETH and matches frames by the update id u.
Mode 3 holds an idle socket with no subscription and no ping to see whether the server closes it.
Run from the repository root with: uv run scripts/probes/venues/unocoin/ws-probe.py
"""

import asyncio
import collections
import json
import statistics
import time

import websockets

URL = "wss://pi42-stream.unocoin.com/ws/public"
BINANCE = "wss://fstream.binance.com/stream?streams=btcusdt@depth20@100ms/ethusdt@depth20@100ms"
GROUPING = {
    "btcinr": "0.1", "ethinr": "0.01", "solinr": "0.01", "xrpinr": "0.0001", "dogeinr": "0.00001",
    "hbarinr": "0.00001", "trxinr": "0.00001", "bchinr": "0.01", "zecinr": "0.01", "ltcinr": "0.01",
    "suiinr": "0.0001", "bnbinr": "0.01", "xlminr": "0.00001", "adainr": "0.0001",
}  # depth_grouping[0] from GET /v1/futures/app-pairs on 2026-10-10


def now_ms():
    return time.time() * 1000


def trim(text, n=500):
    return text if len(text) <= n else text[:n] + f"... ({len(text)} bytes)"


async def mode_protocol():
    print("\n== mode 1: protocol on one socket")
    async with websockets.connect(URL, open_timeout=20, compression="deflate") as ws:
        h = ws.response.headers
        print("handshake", ws.response.status_code, "server", h.get("server"), "extensions", h.get("sec-websocket-extensions") or "none negotiated")
        print("first frame:", await asyncio.wait_for(ws.recv(), 10))
        tests = [
            {"action": "ping"},
            {"action": "subscribe", "channel": "foo@depth_0.1"},
            {"action": "subscribe", "channel": "sandinr@depth_0.01"},
            {"action": "subscribe", "channel": "btcinr@depth_1"},
            {"action": "subscribe", "channel": "btcinr@depth"},
            {"action": "subscribe", "channel": "btcinr@bookTicker"},
            {"action": "subscribe"},
            {"action": "bogus", "channel": "btcinr@ticker"},
        ]
        async def reply_to(frame):
            """Send one frame and return the next ack or error, skipping data frames of earlier test subscriptions."""
            await ws.send(frame)
            t_end = time.time() + 3
            while time.time() < t_end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), t_end - time.time())
                except asyncio.TimeoutError:
                    break
                if "channel" not in json.loads(raw):
                    return raw
            return "(no ack or error in 3 s)"

        for t in tests:
            print(f"sent {json.dumps(t)} got {await reply_to(json.dumps(t))}")
        print(f"sent 'not json' got {await reply_to('not json')}")
        same = {}
        t_end = time.time() + 3
        while time.time() < t_end:
            try:
                j = json.loads(await asyncio.wait_for(ws.recv(), 1))
            except asyncio.TimeoutError:
                continue
            if j.get("channel") in ("btcinr@depth_1", "btcinr@depth"):
                same.setdefault(j["data"]["u"], set()).add(j["channel"])
        both = sum(1 for v in same.values() if len(v) == 2)
        print(f"btcinr@depth_1 and btcinr@depth in 3 s: {len(same)} distinct u, {both} carried by both channels")
        for ch in ("btcinr@depth_1", "btcinr@depth"):
            await ws.send(json.dumps({"action": "unsubscribe", "channel": ch}))

        channels = [f"{s}@depth_{g}" for s, g in GROUPING.items()]
        channels += ["btcinr@markPrice", "btcinr@marketInfo", "btcinr@ticker", "btcinr@aggTrade", "allContractDetails"]
        for ch in channels:
            await ws.send(json.dumps({"action": "subscribe", "channel": ch}))
        acks, errors = 0, []
        frames = collections.defaultdict(list)
        sample = {}
        prev_u = {}
        chained = collections.Counter()
        empty_sides = 0
        levels = collections.Counter()
        order = collections.Counter()
        t0 = time.time()
        while time.time() - t0 < 60:
            raw = await asyncio.wait_for(ws.recv(), 20)
            j = json.loads(raw)
            if "success" in j:
                acks += 1
                continue
            if "error" in j:
                errors.append(j)
                continue
            ch = j.get("channel")
            frames[ch].append(now_ms())
            if ch not in sample:
                sample[ch] = raw
            if "@depth_" in ch:
                d = j["data"]
                if ch in prev_u:
                    chained["pu equals previous u" if d["pu"] == prev_u[ch] else "pu differs from previous u"] += 1
                    chained["u increases" if d["u"] > prev_u[ch] else "u does not increase"] += 1
                prev_u[ch] = d["u"]
                levels[(len(d["b"]), len(d["a"]))] += 1
                if not d["b"] or not d["a"]:
                    empty_sides += 1
                bids = [float(p) for p, q in d["b"]]
                asks = [float(p) for p, q in d["a"]]
                order[("bids ascending" if bids == sorted(bids) else "bids not ascending", "asks ascending" if asks == sorted(asks) else "asks not ascending")] += 1
                if bids and asks and max(bids) >= min(asks):
                    order["crossed"] += 1
        print(f"acks {acks}, errors {errors}")
        total = sum(len(v) for v in frames.values())
        print(f"60 s on one socket: {total} data frames, {total / 60:.1f} per s")
        for ch, ts in sorted(frames.items()):
            gaps = [b - a for a, b in zip(ts, ts[1:])]
            med = statistics.median(gaps) if gaps else 0
            print(f"  {ch}: {len(ts)} frames, median gap {med:.0f} ms, max gap {max(gaps) if gaps else 0:.0f} ms")
        print("depth levels per frame (bids, asks):", dict(levels))
        print("depth level order:", dict(order))
        print("depth one-sided or empty frames:", empty_sides)
        print("depth sequence:", dict(chained))
        for ch in ["btcinr@depth_0.1", "btcinr@markPrice", "btcinr@marketInfo", "btcinr@ticker", "btcinr@aggTrade", "allContractDetails"]:
            print(f"sample {ch}: {trim(sample.get(ch, '(none)'), 700)}")
        all_details = json.loads(sample["allContractDetails"])["data"]
        print("allContractDetails keys:", len(all_details), "INR keys", sum(k.endswith("INR") for k in all_details), "USDT keys", sum(k.endswith("USDT") for k in all_details))
        await ws.send(json.dumps({"action": "unsubscribe", "channel": "btcinr@depth_0.1"}))
        t_end = time.time() + 3
        after = 0
        while time.time() < t_end:
            try:
                raw = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            j = json.loads(raw)
            if "success" in j or "error" in j:
                print("unsubscribe reply:", raw)
            elif j.get("channel") == "btcinr@depth_0.1":
                after += 1
        print("btcinr@depth_0.1 frames in the 3 s after unsubscribe:", after)


async def mode_binance():
    print("\n== mode 2: Unocoin book against Binance USD-M depth20@100ms, 60 s")
    bin_frames = {}  # (symbol, u) to (arrival ms, data)
    uno_frames = []
    async with websockets.connect(BINANCE, open_timeout=20) as b, websockets.connect(URL, open_timeout=20) as u:
        await u.recv()
        for ch in ["btcinr@depth_0.1", "ethinr@depth_0.01", "btcinr@markPrice"]:
            await u.send(json.dumps({"action": "subscribe", "channel": ch}))
        marks = []

        async def read_binance():
            async for raw in b:
                d = json.loads(raw)["data"]
                bin_frames[(d["s"], d["u"])] = (now_ms(), d)

        async def read_unocoin():
            async for raw in u:
                j = json.loads(raw)
                ch = j.get("channel", "")
                if "@depth_" in ch:
                    uno_frames.append((now_ms(), j["data"]))
                elif ch.endswith("@markPrice"):
                    marks.append(j["data"])

        tasks = [asyncio.create_task(read_binance()), asyncio.create_task(read_unocoin())]
        await asyncio.sleep(60)
        for t in tasks:
            t.cancel()
    print(f"Binance frames {len(bin_frames)}, Unocoin depth frames {len(uno_frames)}")
    for sym in ["BTCUSDT", "ETHUSDT"]:
        mine = [(t, d) for t, d in uno_frames if d["ps"] == sym]
        matched, lags, size_same, ratios = 0, [], 0, []
        bid_ratios, ask_ratios, level_counts, total_same = [], [], collections.Counter(), 0
        for t, d in mine:
            hit = bin_frames.get((sym, d["u"]))
            if not hit:
                continue
            matched += 1
            tb, bd = hit
            lags.append(t - tb)
            if [q for p, q in d["b"]] == [q for p, q in sorted(bd["b"], key=lambda x: float(x[0]))] and [q for p, q in d["a"]] == [q for p, q in bd["a"]]:
                size_same += 1
            bb_u = max(float(p) for p, q in d["b"])
            ba_u = min(float(p) for p, q in d["a"])
            bb_b = max(float(p) for p, q in bd["b"])
            ba_b = min(float(p) for p, q in bd["a"])
            ratios.append(((bb_u + ba_u) / 2) / ((bb_b + ba_b) / 2))
            bid_ratios.append(bb_u / bb_b)
            ask_ratios.append(ba_u / ba_b)
            level_counts[(len(d["b"]), len(d["a"]), len(bd["b"]), len(bd["a"]))] += 1
            qty = lambda side: round(sum(float(q) for p, q in side), 6)
            if qty(d["b"]) == qty(bd["b"]) and qty(d["a"]) == qty(bd["a"]):
                total_same += 1
        print(f"{sym}: Unocoin frames {len(mine)}, matched to a Binance frame by u {matched}")
        if lags:
            print(f"  arrival lag Unocoin minus Binance ms: median {statistics.median(lags):.0f}, min {min(lags):.0f}, max {max(lags):.0f}")
            print(f"  frames whose 20 bid and 20 ask sizes equal Binance's in order: {size_same} of {matched}")
            print(f"  frames whose summed bid and ask size equals Binance's: {total_same} of {matched}")
            print(f"  levels (Unocoin bids, asks, Binance bids, asks): {dict(level_counts)}")
            print(f"  mid ratio INR per USDT: median {statistics.median(ratios):.4f}, min {min(ratios):.4f}, max {max(ratios):.4f}")
            print(f"  best bid ratio: median {statistics.median(bid_ratios):.5f}, best ask ratio: median {statistics.median(ask_ratios):.5f}")
        if len(mine) > 1:
            gaps = [b[0] - a[0] for a, b in zip(mine, mine[1:])]
            print(f"  Unocoin frame gap ms: median {statistics.median(gaps):.0f}, max {max(gaps):.0f}")
    if marks:
        m = marks[-1]
        print(f"markPrice fields: {sorted(m)}, last {m}")
        print(f"  mark p / ap {float(m['p']) / float(m['ap']):.4f}, T {m['T']} ({time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(m['T'] / 1000))})")


async def mode_idle():
    print("\n== mode 3: idle socket, no subscription and no ping, up to 100 s")
    t0 = time.time()
    try:
        async with websockets.connect(URL, open_timeout=20, ping_interval=None) as ws:
            print("first frame:", await ws.recv())
            while time.time() - t0 < 100:
                try:
                    raw = await asyncio.wait_for(ws.recv(), 100 - (time.time() - t0))
                    print(f"{time.time() - t0:.1f} s frame: {trim(str(raw), 200)}")
                except asyncio.TimeoutError:
                    break
            print(f"still open after {time.time() - t0:.0f} s with no client traffic")
    except websockets.ConnectionClosed as e:
        print(f"closed after {time.time() - t0:.1f} s: code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None}")


async def main():
    print("started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    idle = asyncio.create_task(mode_idle())
    await mode_protocol()
    await mode_binance()
    await idle
    print("\nfinished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
