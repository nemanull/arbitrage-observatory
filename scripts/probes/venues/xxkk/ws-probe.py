# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""XXKK public WebSocket probe for docs/profiles/xxkk/.

XXKK publishes no API, so both sockets here are the ones the futures web page opens without a login.
Read-only and unauthenticated, about 4 minutes of sockets in total.
Run from the repository root with: uv run scripts/probes/venues/xxkk/ws-probe.py
"""

import asyncio
import collections
import json
import time
import urllib.request

import websockets

QUOTE_WS = "wss://q.xkqts.com/wsquote"  # first swap_quote_domain plus /wsquote, as the web client builds it
STREAM_WS = "wss://www.xxkk.com/api/stream"  # web client's "swap-messager" socket
QUOTE_HTTP = "https://q.xkqts.com"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
BOOK_SYMBOLS = ["BTC-USDT", "ETH-USDT", "SOL-USDC", "NVDA-USDT", "DOGE-USDT"]


def rest_depth(sym: str, size: int = 200) -> dict:
    req = urllib.request.Request(f"{QUOTE_HTTP}/mkpai/depth-v2?businessType={sym}&dType=0&size={size}", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())["data"]


def section(title: str) -> None:
    print(f"\n=== {title}")


async def recv_for(ws, seconds: float):
    """Yield (elapsed, text) for every frame within the window."""
    t0 = time.monotonic()
    while (left := seconds - (time.monotonic() - t0)) > 0:
        try:
            msg = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            return
        yield time.monotonic() - t0, msg


async def handshake_and_single() -> None:
    section("A. handshake and one symbol for 20 s")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None) as ws:
        print("status", ws.response.status_code, "extensions", ws.response.headers.get_all("sec-websocket-extensions"), "server", ws.response.headers.get("server"))
        await ws.send(json.dumps({"cmid": "3000"}))
        await ws.send(json.dumps({"cmid": "4001", "symbols": "BTC-USDT", "r": 1, "data": "24"}))
        counts = collections.Counter()
        first = {}
        book_types = collections.Counter()
        vs = []
        async for t, msg in recv_for(ws, 20):
            if isinstance(msg, bytes):
                counts["binary"] += 1
                continue
            frame = json.loads(msg)
            cmid = frame.get("cmid")
            counts[cmid] += 1
            first.setdefault(cmid, (round(t, 2), msg[:500]))
            if cmid == "7001":
                d = json.loads(frame["data"])
                book_types[d.get("type")] += 1
                vs.append((d["v"], d.get("a")))
        print("frames by cmid", dict(counts))
        for cmid, (t, sample) in first.items():
            print(f"first {cmid} at {t}s: {sample}")
        print("7001 types", dict(book_types))
        if vs:
            steps = collections.Counter(b[0] - a[0] for a, b in zip(vs, vs[1:]))
            print("7001 v steps", dict(steps), "v equals a on all", all(v == a for v, a in vs))


async def book_sequence() -> None:
    section("B0. one 4001 frame naming three symbols")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None) as ws:
        await ws.send(json.dumps({"cmid": "4001", "symbols": ",".join(BOOK_SYMBOLS[:3]), "r": 1, "data": "24"}))
        t0 = time.monotonic()
        n = 0
        try:
            async for t, msg in recv_for(ws, 12):
                n += 1
            print(f"still open after 12 s, {n} frames")
        except websockets.ConnectionClosed as e:
            print(f"server closed after {time.monotonic() - t0:.1f} s and {n} frames: code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None!r}")

    section("B1. one 4001 frame per symbol, a new symbol every 8 s, until the server closes")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None) as ws:
        t0 = time.monotonic()
        added = []
        try:
            for sym in BOOK_SYMBOLS:
                await ws.send(json.dumps({"cmid": "4001", "symbols": sym, "r": 1, "data": "24"}))
                added.append(sym)
                async for t, msg in recv_for(ws, 8):
                    pass
                print(f"open with {len(added)} symbols at {time.monotonic() - t0:.1f} s")
            print("never closed")
        except websockets.ConnectionClosed as e:
            print(f"server closed {time.monotonic() - t0:.1f} s after open, with {len(added)} symbols subscribed: code={e.rcvd.code if e.rcvd else None}")


async def book_sequence_two(syms: list[str]) -> None:
    section(f"B. {len(syms)} symbols on one socket, one 4001 frame each, for 90 s, REST seed bridged to the deltas")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None) as ws:
        for sym in syms:
            await ws.send(json.dumps({"cmid": "4001", "symbols": sym, "r": 1, "data": "24"}))
        seeds = {}
        for sym in syms:
            seeds[sym] = rest_depth(sym)
        print("seed v", {s: seeds[s]["v"] for s in syms})
        books = {s: ({a["price"]: a["amount"] for a in seeds[s]["asks"]}, {b["price"]: b["amount"] for b in seeds[s]["bids"]}) for s in syms}
        last_v = {s: seeds[s]["v"] for s in syms}
        stats = collections.defaultdict(collections.Counter)
        detail_syms = collections.Counter()
        unordered = 0
        crossed = 0
        levels_per = []
        last_heart = time.monotonic()
        closed = None
        try:
            async for t, msg in recv_for(ws, 90):
                if time.monotonic() - last_heart > 5:
                    await ws.send(json.dumps({"cmid": "3000"}))
                    last_heart = time.monotonic()
                frame = json.loads(msg)
                if frame.get("cmid") == "4001":
                    detail_syms[json.loads(frame["data"])["symbol"]] += 1
                if frame.get("cmid") != "7001":
                    continue
                d = json.loads(frame["data"])
                s = d["s"]
                if s not in last_v:
                    stats["?"]["foreign"] += 1
                    continue
                st = stats[s]
                st["deltas"] += 1
                st[f"type{d['type']}"] += 1
                v = d["v"]
                if v <= last_v[s]:
                    st["stale_or_dup"] += 1
                    continue
                if v == last_v[s] + 1:
                    st["contiguous"] += 1
                else:
                    st["gap"] += 1
                    st["gap_size_sum"] += v - last_v[s] - 1
                last_v[s] = v
                asks, bids = books[s]
                levels_per.append(len(d.get("asks", [])) + len(d.get("bids", [])))
                st["no_bids_key"] += "bids" not in d
                st["no_asks_key"] += "asks" not in d
                prices = [p for p, _ in d.get("bids", [])]
                if prices != sorted(prices, reverse=True):
                    unordered += 1
                for p, a in d.get("asks", []):
                    if a == 0:
                        asks.pop(p, None)
                        st["zero_removes"] += 1
                    else:
                        asks[p] = a
                for p, a in d.get("bids", []):
                    if a == 0:
                        bids.pop(p, None)
                    else:
                        bids[p] = a
                if asks and bids and max(bids) >= min(asks):
                    crossed += 1
        except websockets.ConnectionClosed as e:
            closed = e.rcvd
        print("server close during B:", closed)
        for s in syms:
            print(s, dict(stats[s]))
        print("frames with unordered bid levels", unordered, "of", sum(st["deltas"] for st in stats.values()))
        print("levels per delta: median", sorted(levels_per)[len(levels_per) // 2] if levels_per else None, "max", max(levels_per) if levels_per else None)
        print("crossed books after applying deltas", crossed)
        print("4001 detail frames by symbol", dict(detail_syms))
        # Compare the locally kept top of book with a fresh REST read.
        for s in syms:
            fresh = rest_depth(s, 5)
            asks, bids = books[s]
            print(f"{s} local best bid/ask {max(bids) if bids else None}/{min(asks) if asks else None} at v={last_v[s]}, REST {fresh['bids'][0]['price'] if fresh['bids'] else None}/{fresh['asks'][0]['price'] if fresh['asks'] else None} at v={fresh['v']}")


async def unknown_and_silence() -> None:
    section("C. unknown symbol, then no client heartbeat for 45 s")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None, ping_interval=None) as ws:
        await ws.send(json.dumps({"cmid": "4001", "symbols": "NOPE-USDT", "r": 1, "data": "24"}))
        n = 0
        async for t, msg in recv_for(ws, 6):
            n += 1
            if n <= 3:
                print(f"unknown symbol frame at {t:.2f}s: {msg[:300]}")
        print("frames after unknown symbol in 6 s:", n)
        await ws.send(json.dumps({"cmid": "4001", "symbols": "BTC-USDT", "r": 1, "data": "24"}))
        t0 = time.monotonic()
        try:
            async for t, msg in recv_for(ws, 45):
                pass
            print(f"socket still open after {time.monotonic() - t0:.0f} s without heartbeats or pings")
        except websockets.ConnectionClosed as e:
            print(f"closed after {time.monotonic() - t0:.1f} s: code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None}")
    section("C2. heartbeat reply")
    async with websockets.connect(QUOTE_WS, user_agent_header=UA, max_size=None) as ws:
        await ws.send(json.dumps({"cmid": "3000"}))
        async for t, msg in recv_for(ws, 3):
            print(f"after cmid 3000 at {t:.2f}s: {msg[:200]}")
        await ws.send("ping")
        async for t, msg in recv_for(ws, 3):
            print(f"after text ping at {t:.2f}s: {msg[:200]}")


async def stream_socket() -> None:
    section("D. www.xxkk.com/api/stream flagprice_list for 20 s")
    async with websockets.connect(STREAM_WS, user_agent_header=UA, max_size=None) as ws:
        print("status", ws.response.status_code, "extensions", ws.response.headers.get_all("sec-websocket-extensions"))
        await ws.send(json.dumps({"method": "heart"}))
        await ws.send(json.dumps({"method": "subscribe", "params": [{"channel": "flagprice_list"}]}))
        pushes = []
        async for t, msg in recv_for(ws, 20):
            frame = json.loads(msg)
            if frame.get("event") in ("heart", "subscribe"):
                print(f"{frame.get('event')} at {t:.2f}s: {msg[:200]}")
                continue
            if isinstance(frame.get("data"), list):
                pushes.append((t, frame["data"]))
        print("pushes", len(pushes), "times", [round(t, 1) for t, _ in pushes])
        if pushes:
            rows = pushes[-1][1]
            print("rows per push", [len(r) for _, r in pushes], "keys", sorted(rows[0]))
            syms = {r["s"] for r in rows}
            print("distinct symbols", len(syms), "USDC rows", sum(1 for s in syms if s.endswith("-USDC")))
            btc = [r for _, rs in pushes for r in rs if r["s"] == "BTC-USDT"]
            print("BTC-USDT rows", btc[:3])


async def main() -> None:
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    await handshake_and_single()
    await book_sequence()
    await book_sequence_two(["BTC-USDT", "SOL-USDC"])
    await unknown_and_silence()
    await stream_socket()


if __name__ == "__main__":
    asyncio.run(main())
