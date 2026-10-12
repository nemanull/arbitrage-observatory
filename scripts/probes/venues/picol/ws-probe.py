# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Picol public market data WebSocket probe for docs/profiles/picol/websocket.md.

Read-only and unauthenticated.
Picol publishes no socket documentation, so the frames below are the Pionex open API frames, sent to wss://ws.picol.com/wsPub.
The same ORDERBOOK subscriptions go to wss://ws.pionex.com/wsPub at the same time, to test whether the two hosts carry one book.
It holds two sockets for about 80 seconds, then one socket for about 10 seconds to test compression, about three minutes of socket time in total.
Every socket sends at most 4 client frames per second, inside the 5 per second Pionex documents.
Run from the repository root with: uv run scripts/probes/venues/picol/ws-probe.py
"""

import asyncio
import collections
import json
import statistics
import time
import urllib.request

import websockets

PICOL = "wss://ws.picol.com/wsPub"
PIONEX = "wss://ws.pionex.com/wsPub"
BOOK_SYMBOLS = ["BTC_USDT_PERP", "ETH_USDT_PERP", "SOL_USDT_PERP", "BTC_USDT"]
RUN_SECONDS = 80


def now_ms() -> int:
    return int(time.time() * 1000)


class Tap:
    """Collects what one socket delivered."""

    def __init__(self, name: str):
        self.name = name
        self.open_ms = None
        self.headers = {}
        self.first = {}  # first frame of each kind, for the capture section
        self.last_number = {}
        self.gaps = collections.Counter()
        self.updates = collections.Counter()
        self.snapshots = {}
        self.snap_delay = {}
        self.sub_sent = {}
        self.book_times = collections.defaultdict(list)
        self.by_number = {}  # (symbol, number) to (receive ms, data)
        self.pings = []
        self.errors = []
        self.acks = []
        self.depth_frames = collections.Counter()
        self.index_frames = collections.Counter()
        self.trade_frames = collections.Counter()
        self.binary = 0
        self.text = 0
        self.levels = collections.defaultdict(list)
        self.empty_updates = collections.Counter()
        self.data_age = []
        self.trade_sizes = {}  # tradeId to size string
        self.order = collections.Counter()  # snapshots and updates whose levels come best first


async def send(ws, tap: Tap, frame: dict) -> None:
    await ws.send(json.dumps(frame))
    if frame.get("op") == "SUBSCRIBE":
        tap.sub_sent[(frame["topic"], frame["symbol"])] = now_ms()
    await asyncio.sleep(0.26)


def handle(tap: Tap, raw, ws_send_queue: list) -> None:
    t = now_ms()
    if isinstance(raw, bytes):
        tap.binary += 1
        raw = raw.decode("utf-8")
    else:
        tap.text += 1
    msg = json.loads(raw)
    if msg.get("op") == "PING":
        tap.pings.append(t)
        tap.first.setdefault("ping", raw)
        ws_send_queue.append({"op": "PONG", "timestamp": t})
        return
    if msg.get("type") == "SUBSCRIBED":
        tap.acks.append((msg.get("topic"), msg.get("symbol"), t - tap.sub_sent.get((msg.get("topic"), msg.get("symbol")), t)))
        tap.first.setdefault("ack", raw)
        return
    if msg.get("type") == "ERROR":
        tap.errors.append(raw)
        return
    topic, sym, data = msg.get("topic"), msg.get("symbol"), msg.get("data")
    if topic == "ORDERBOOK":
        tap.book_times[sym].append(t)
        if isinstance(data.get("timestamp"), int):
            tap.data_age.append(t - data["timestamp"])
        if data["action"] == "SNAPSHOT":
            tap.snapshots[sym] = tap.snapshots.get(sym, 0) + 1
            tap.snap_delay.setdefault(sym, t - tap.sub_sent.get(("ORDERBOOK", sym), t))
            tap.levels[sym].append((len(data["bids"]), len(data["asks"])))
            tap.first.setdefault("snapshot", raw)
        else:
            tap.updates[sym] += 1
            if sym in tap.last_number and data["prevNumber"] != tap.last_number[sym]:
                tap.gaps[sym] += 1
            if not data["bids"] and not data["asks"]:
                tap.empty_updates[sym] += 1
            tap.first.setdefault("update", raw)
        bids = [float(x[0]) for x in data["bids"]]
        asks = [float(x[0]) for x in data["asks"]]
        best_first = bids == sorted(bids, reverse=True) and asks == sorted(asks)
        tap.order["best first" if best_first else "other order"] += 1
        tap.last_number[sym] = data["number"]
        tap.by_number[(sym, data["number"])] = (t, data)
    elif topic == "DEPTH":
        tap.depth_frames[sym] += 1
        tap.first.setdefault("depth", raw)
    elif topic == "INDEX":
        tap.index_frames[sym] += 1
        tap.first.setdefault("index", raw)
    elif topic == "TRADE":
        tap.trade_frames[sym] += 1
        tap.first.setdefault("trade", raw)
        for tr in data:
            tap.trade_sizes[tr["tradeId"]] = tr["size"]


async def run_socket(url: str, tap: Tap, extra: bool, seconds: float) -> None:
    t0 = time.perf_counter()
    async with websockets.connect(url, compression=None, max_size=2**24, ping_interval=None, open_timeout=15) as ws:
        tap.open_ms = round((time.perf_counter() - t0) * 1000)
        tap.headers = {k.lower(): v for k, v in ws.response.headers.raw_items()}
        end = time.time() + seconds
        queue: list = []

        async def reader() -> None:
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
                except asyncio.TimeoutError:
                    return
                handle(tap, raw, queue)
                while queue:
                    await ws.send(json.dumps(queue.pop(0)))

        task = asyncio.create_task(reader())
        for s in BOOK_SYMBOLS:
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": s})
        if extra:
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "BTC_USDT_PERP", "limit": 20})
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "INDEX", "symbol": "BTC_USDT_PERP"})
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "TRADE", "symbol": "BTC_USDT_PERP"})
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "NOPE_USDT_PERP"})
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP,ETH_USDT_PERP"})
            await send(ws, tap, {"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "BTC_USDT_PERP", "limit": 500})
            await send(ws, tap, {"op": "PING", "timestamp": now_ms()})
        await task


def report(tap: Tap) -> None:
    print(f"\n=== {tap.name}")
    print(f"open in {tap.open_ms} ms, server {tap.headers.get('server') or tap.headers.get('Server')}, extensions {tap.headers.get('sec-websocket-extensions')}")
    print(f"frames: {tap.binary} binary, {tap.text} text")
    print(f"acks (topic, symbol, ms after send): {tap.acks}")
    print(f"snapshot delay after subscribe ms: {tap.snap_delay}, snapshots {tap.snapshots}, levels {dict((k, v[:2]) for k, v in tap.levels.items())}")
    for s in BOOK_SYMBOLS:
        ts = tap.book_times.get(s, [])
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        g = f"median {statistics.median(gaps):.0f} ms, max {max(gaps)} ms" if gaps else "none"
        print(f"{s}: {tap.updates[s]} updates, {tap.gaps[s]} prevNumber gaps, {tap.empty_updates[s]} empty, inter-frame {g}")
    if tap.data_age:
        print(f"data.timestamp age on arrival: median {statistics.median(tap.data_age):.0f}, min {min(tap.data_age)}, max {max(tap.data_age)} ms")
    print(f"ORDERBOOK frames by level order: {dict(tap.order)}")
    p = tap.pings
    print(f"server PINGs: {len(p)}, spacing {[b - a for a, b in zip(p, p[1:])]} ms")
    print(f"DEPTH {dict(tap.depth_frames)}, INDEX {dict(tap.index_frames)}, TRADE {dict(tap.trade_frames)}")
    for e in tap.errors:
        print(f"error frame: {e}")


def compare(a: Tap, b: Tap) -> None:
    print("\n=== Picol against Pionex on the same symbols")
    for s in BOOK_SYMBOLS:
        na = {n for (sym, n) in a.by_number if sym == s}
        nb = {n for (sym, n) in b.by_number if sym == s}
        both = na & nb
        ratios, same_px, lag = [], 0, []
        for n in both:
            ta, da = a.by_number[(s, n)]
            tb, db = b.by_number[(s, n)]
            lag.append(ta - tb)
            pa = [x[0] for x in da["bids"] + da["asks"]]
            pb = [x[0] for x in db["bids"] + db["asks"]]
            same_px += pa == pb
            ratios += [float(x[1]) / float(y[1]) for x, y in zip(da["bids"] + da["asks"], db["bids"] + db["asks"]) if x[0] == y[0] and float(y[1]) >= 0.01]
        r = f"size ratio min {min(ratios):.4f}, median {statistics.median(ratios):.4f}, max {max(ratios):.4f} over {len(ratios)} levels" if ratios else "no sizes"
        lg = f"Picol arrival minus Pionex arrival median {statistics.median(lag):.0f} ms, min {min(lag)}, max {max(lag)}" if lag else ""
        print(f"{s}: numbers Picol {len(na)}, Pionex {len(nb)}, shared {len(both)}, same price list {same_px}, {r}, {lg}")


def rest_trades(host: str) -> dict:
    req = urllib.request.Request(f"https://{host}/api/v1/market/trades?symbol=BTC_USDT_PERP&limit=100", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return {t["tradeId"]: t["size"] for t in json.load(r)["data"]["trades"]}


def trades_against_rest(tap: Tap) -> None:
    print("\n=== Socket trade sizes against REST trade sizes, BTC_USDT_PERP, matched by tradeId")
    for host in ("api.picol.com", "api.pionex.com"):
        rest = rest_trades(host)
        both = [i for i in tap.trade_sizes if i in rest]
        equal = sum(1 for i in both if float(tap.trade_sizes[i]) == float(rest[i]))
        ratios = [float(rest[i]) / float(tap.trade_sizes[i]) for i in both if float(tap.trade_sizes[i]) >= 0.01]
        r = f"REST over socket median {statistics.median(ratios):.4f}, min {min(ratios):.4f}, max {max(ratios):.4f}" if ratios else "no ratio"
        print(f"{host}: {len(both)} trades matched, equal size on {equal}, {r}")
        time.sleep(0.5)


async def compression_check() -> None:
    print("\n=== Compression offered by the client")
    async with websockets.connect(PICOL, compression="deflate", ping_interval=None, open_timeout=15) as ws:
        print(f"sec-websocket-extensions answered: {dict(ws.response.headers.raw_items()).get('Sec-WebSocket-Extensions') or dict((k.lower(), v) for k, v in ws.response.headers.raw_items()).get('sec-websocket-extensions')}")
        await ws.send(json.dumps({"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP"}))
        kinds = collections.Counter()
        end = time.time() + 8
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            m = json.loads(raw)
            kinds[m.get("type") or (m.get("data") or {}).get("action") or m.get("op")] += 1
        print(f"frames in 8 s with deflate offered: {dict(kinds)}")


def captures(tap: Tap) -> None:
    print("\n=== Captured frames from Picol, trimmed to three levels")
    for k in ("ack", "snapshot", "update", "depth", "index", "trade", "ping"):
        raw = tap.first.get(k)
        if not raw:
            print(f"{k}: none")
            continue
        m = json.loads(raw)
        d = m.get("data")
        if isinstance(d, dict):
            for side in ("bids", "asks"):
                if side in d:
                    d[side] = d[side][:3]
        print(f"{k}: {json.dumps(m, separators=(',', ':'), ensure_ascii=False)}")


async def main() -> None:
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    a, b = Tap("Picol wss://ws.picol.com/wsPub"), Tap("Pionex wss://ws.pionex.com/wsPub")
    await asyncio.gather(run_socket(PICOL, a, True, RUN_SECONDS), run_socket(PIONEX, b, False, RUN_SECONDS))
    report(a)
    report(b)
    compare(a, b)
    captures(a)
    trades_against_rest(a)
    await compression_check()
    print(f"\ndone at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")


if __name__ == "__main__":
    asyncio.run(main())
