# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""BitTap futures WebSocket book probe for docs/profiles/bittap/websocket.md.

Public, unauthenticated and read-only.
It holds sockets open for about 2 minutes of wall time, in this order:
  A. 20 s on BTC, ETH and one quiet contract at f_depth30, timing, sequence and level checks.
  B. 8 s of depth and scale variants, unknown, settled and malformed topics, PING and a protocol ping.
  C. 15 s with every OPEN contract's f_depth30 on one socket.
  D. 75 s on three sockets at once, each with one stream: no client ping, a JSON PING every 25 s, a protocol ping every 25 s.
Run from the repository root with: uv run scripts/probes/venues/bittap/ws-probe.py
"""

import asyncio
import collections
import json
import statistics
import time
import urllib.request

import websockets

URL = "wss://stream.bittap.com/endpoint?format=JSON"
CATALOG = "https://api.bittap.com/asset/public/v1/exchange/info"


def load_catalog():
    req = urllib.request.Request(CATALOG, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)["data"]
    cs = data["contractSymbols"]
    return [s for s in cs if s["status"] == "OPEN"], [s for s in cs if s["status"] != "OPEN"]


def topic(sym) -> str:
    return f"f_depth30@{sym['symbolId']}_{sym['depths'][0]}"


async def connect():
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, compression=None, ping_interval=None, max_size=None, open_timeout=20)
    return ws, time.perf_counter() - t0


def trim(frame: str, n: int = 3) -> str:
    """Shorten a book frame to n levels per side for printing."""
    try:
        d = json.loads(frame)
    except json.JSONDecodeError:
        return frame[:300]
    if isinstance(d, dict) and "bids" in d:
        d = dict(d)
        nb, na = len(d["bids"]), len(d["asks"])
        d["bids"] = d["bids"][:n] + [f"... {nb} levels"]
        d["asks"] = d["asks"][:n] + [f"... {na} levels"]
    return json.dumps(d)[:700]


async def part_a(live) -> None:
    print("\n=== A. f_depth30 on BTC, ETH and a quiet contract for 20 s")
    by_id = {s["symbolId"]: s for s in live}
    quiet = next(s for s in live if s["recommended"] == "NO" and s["symbolId"] not in ("BTC-USDT-M", "ETH-USDT-M") and s["settleCycle"] == 4)
    picks = [by_id["BTC-USDT-M"], by_id["ETH-USDT-M"], quiet]
    ws, dt = await connect()
    print(f"connected in {dt * 1000:.0f} ms, negotiated extensions: {ws.response.headers.get('Sec-WebSocket-Extensions')}")
    first = await asyncio.wait_for(ws.recv(), 10)
    print("first frame after open:", first)
    t_sub = time.perf_counter()
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": [topic(s) for s in picks], "id": 7}))
    stats = {s["symbolId"]: {"times": [], "ids": [], "levels": set(), "order_ok": True, "crossed": 0, "repeats": 0, "last": None, "first_at": None} for s in picks}
    acks = []
    end = t_sub + 20
    while time.perf_counter() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), max(0.1, end - time.perf_counter()))
        except asyncio.TimeoutError:
            break
        now = time.perf_counter()
        d = json.loads(raw)
        if "e" not in d:
            acks.append((round((now - t_sub) * 1000), raw))
            continue
        st = stats[d["s"]]
        if st["first_at"] is None:
            st["first_at"] = now - t_sub
            print(f"first book frame for {d['s']} {st['first_at'] * 1000:.0f} ms after subscribe: {trim(raw)}")
        st["times"].append(now)
        st["ids"].append(d["lastUpdateId"])
        st["levels"].add((len(d["bids"]), len(d["asks"])))
        b = [float(p) for p, _ in d["bids"]]
        a = [float(p) for p, _ in d["asks"]]
        if b != sorted(b, reverse=True) or a != sorted(a):
            st["order_ok"] = False
        if b and a and b[0] >= a[0]:
            st["crossed"] += 1
        body = (tuple(map(tuple, d["bids"])), tuple(map(tuple, d["asks"])))
        if body == st["last"]:
            st["repeats"] += 1
        st["last"] = body
    await ws.close()
    print("acks:", acks)
    for sid, st in stats.items():
        t = st["times"]
        gaps = [round((t[i + 1] - t[i]) * 1000) for i in range(len(t) - 1)]
        steps = [st["ids"][i + 1] - st["ids"][i] for i in range(len(st["ids"]) - 1)]
        print(f"{sid}: frames {len(t)}, interval median {statistics.median(gaps) if gaps else None} ms min {min(gaps) if gaps else None} max {max(gaps) if gaps else None}, "
              f"levels per side seen {sorted(st['levels'])}, best first on both sides {st['order_ok']}, crossed frames {st['crossed']}, frames identical to the previous {st['repeats']}, "
              f"lastUpdateId steps min {min(steps) if steps else None} max {max(steps) if steps else None}, non-increasing steps {sum(1 for x in steps if x <= 0)}")


async def part_b(live, settled) -> None:
    print("\n=== B. variants, errors and keepalive, 8 s")
    ws, _ = await connect()
    await asyncio.wait_for(ws.recv(), 10)
    btc = "BTC-USDT-M"
    tests = [
        ("levels", [f"f_depth1@{btc}_0.1", f"f_depth5@{btc}_0.1", f"f_depth10@{btc}_0.1", f"f_depth20@{btc}_0.1", f"f_depth50@{btc}_0.1", f"f_depth100@{btc}_0.1"]),
        ("scale 1 and scale not in depths", [f"f_depth30@{btc}_1", f"f_depth30@{btc}_0.5"]),
        ("no scale", [f"f_depth30@{btc}"]),
        ("unknown symbol", ["f_depth30@NOPE-USDT-M_0.1"]),
        ("settled symbol", [f"f_depth30@{settled[0]['symbolId']}_{settled[0]['depths'][0]}"]),
        ("unknown channel", [f"f_nope@{btc}"]),
        ("lower-case symbol", ["f_depth30@btc-usdt-m_0.1"]),
    ]
    seen = collections.defaultdict(lambda: {"n": 0, "levels": set(), "e": set()})
    for i, (label, params) in enumerate(tests, start=100):
        await ws.send(json.dumps({"method": "SUBSCRIBE", "params": params, "id": i}))
    await ws.send("not json")
    await ws.send(json.dumps({"method": "BOGUS", "id": 200}))
    await ws.send(json.dumps({"id": "922bcc6e", "method": "PING"}))
    await ws.send(json.dumps({"id": "187d3cb2", "method": "time"}))
    pong_waiter = await ws.ping(b"probe")
    t_ping = time.perf_counter()
    pong_ms = None
    others = []
    end = time.perf_counter() + 8
    while time.perf_counter() < end:
        if pong_ms is None and pong_waiter.done():
            pong_ms = (time.perf_counter() - t_ping) * 1000
        try:
            raw = await asyncio.wait_for(ws.recv(), 0.2)
        except asyncio.TimeoutError:
            continue
        d = json.loads(raw) if raw.startswith("{") else raw
        if isinstance(d, dict) and "e" in d:
            key = f"{d['e']} {d['s']} i={d['i']}"
            seen[key]["n"] += 1
            seen[key]["levels"].add((len(d["bids"]), len(d["asks"])))
        else:
            others.append(raw[:300])
    await ws.close()
    print(f"protocol ping answered with a pong in {pong_ms:.0f} ms" if pong_ms is not None else "protocol ping not answered within 8 s")
    print("non-book frames in order:")
    for o in others:
        print("  ", o)
    print("book streams that delivered:")
    for k, v in sorted(seen.items()):
        print(f"   {k}: {v['n']} frames, levels per side {sorted(v['levels'])}")
    print("tests sent:", [(i, label, params) for i, (label, params) in enumerate(tests, start=100)])


async def part_c(live) -> None:
    print(f"\n=== C. every OPEN contract ({len(live)}) on one socket, 15 s")
    ws, _ = await connect()
    await asyncio.wait_for(ws.recv(), 10)
    topics = [topic(s) for s in live]
    t0 = time.perf_counter()
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": topics, "id": 1}))
    counts = collections.Counter()
    acks = []
    frames = 0
    nbytes = 0
    end = t0 + 15
    closed = None
    while time.perf_counter() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), max(0.1, end - time.perf_counter()))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            closed = f"closed after {time.perf_counter() - t0:.1f} s: code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None}"
            break
        frames += 1
        nbytes += len(raw)
        if raw.startswith('{"e"'):
            counts[json.loads(raw)["s"]] += 1
        else:
            acks.append(raw[:200])
    elapsed = time.perf_counter() - t0
    if closed is None:
        await ws.close()
    print(f"acks: {acks}")
    print(f"closed: {closed}")
    print(f"frames {frames} in {elapsed:.1f} s = {frames / elapsed:.0f} per s, {nbytes / elapsed / 1024:.0f} KiB per s")
    silent = [s["symbolId"] for s in live if counts[s["symbolId"]] == 0]
    print(f"contracts that delivered at least one frame: {len(counts)} of {len(live)}, silent: {silent}")
    per = sorted(counts.values())
    if per:
        print(f"frames per contract in 15 s: min {per[0]} median {statistics.median(per)} max {per[-1]}")


async def hold(sym, mode: str) -> str:
    """Hold one f_markPrice stream for 75 s with the given keepalive and report how it ended."""
    ws, _ = await connect()
    await asyncio.wait_for(ws.recv(), 10)
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": [f"f_markPrice@{sym}"], "id": 1}))
    t0 = time.perf_counter()
    next_ping = t0 + 25
    frames = 0
    replies = []
    while time.perf_counter() - t0 < 75:
        now = time.perf_counter()
        if mode != "none" and now >= next_ping:
            next_ping += 25
            if mode == "json":
                await ws.send(json.dumps({"id": f"ka{int(now - t0)}", "method": "PING"}))
            else:
                await ws.ping(b"ka")
        try:
            raw = await asyncio.wait_for(ws.recv(), min(1.0, max(0.05, next_ping - time.perf_counter())))
            if json.loads(raw).get("e") == "f_markPrice":
                frames += 1
            else:
                replies.append(f"{time.perf_counter() - t0:.1f} s {raw[:80]}")
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as e:
            return f"keepalive {mode}: {frames} frames, closed by server after {time.perf_counter() - t0:.1f} s ({e}), replies {replies}"
    await ws.close()
    return f"keepalive {mode}: {frames} frames, still open after 75 s, replies {replies}"


async def part_d(live) -> None:
    print("\n=== D. keepalive, three sockets at once for 75 s, one f_markPrice stream each")
    quiet = next(s for s in live if s["symbolId"] not in ("BTC-USDT-M", "ETH-USDT-M") and s["recommended"] == "NO")
    results = await asyncio.gather(*(hold(quiet["symbolId"], mode) for mode in ("none", "json", "protocol")))
    for r in results:
        print(r)


async def main() -> None:
    print("BitTap WebSocket probe, UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    live, settled = load_catalog()
    print(f"catalog: {len(live)} OPEN, {len(settled)} SETTLED")
    await part_a(live)
    await part_b(live, settled)
    await part_c(live)
    await part_d(live)


if __name__ == "__main__":
    asyncio.run(main())
