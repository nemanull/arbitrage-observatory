# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""CriptoSwaps public WebSocket probe for docs/profiles/criptoswaps/.

The socket is Openware's Ranger at /api/v2/ranger/public/, the one the web trade page opens.
Read-only and unauthenticated, about 4 minutes of sockets in total.
Run from the repository root with: uv run scripts/probes/venues/criptoswaps/ws-probe.py
"""

import asyncio
import collections
import json
import time
import urllib.request

import websockets

WS = "wss://www.criptoswaps.com/api/v2/ranger/public/"
REST = "https://www.criptoswaps.com/api/v2/peatio/public"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
MARKETS = ["btcusdt", "ethusdt", "zecbtc", "qntusdt", "dogeusdt"]  # top CoinMarketCap pairs plus two majors


def section(title: str) -> None:
    print(f"\n=== {title}")


def rest_depth(market: str) -> dict:
    req = urllib.request.Request(f"{REST}/markets/{market}/depth?limit=1000", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


async def recv_for(ws, seconds: float):
    """Yield (elapsed, text) for every frame within the window."""
    t0 = time.monotonic()
    while (left := seconds - (time.monotonic() - t0)) > 0:
        try:
            msg = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            return
        yield time.monotonic() - t0, msg


def apply(book: dict, side: str, pair: list) -> None:
    price, amount = pair
    if amount == "" or float(amount) == 0:
        book[side].pop(price, None)
    else:
        book[side][price] = amount


def ordered(side: list, ascending: bool) -> bool:
    px = [float(p) for p, _ in side]
    return px == sorted(px, reverse=not ascending)


async def books_by_url(seconds: float = 75) -> None:
    section(f"A. streams named in the URL, {len(MARKETS)} ob-inc books plus trades and global.tickers, {seconds:.0f} s")
    url = WS + "?" + "&".join(f"stream={m}.ob-inc" for m in MARKETS) + "&stream=btcusdt.trades&stream=global.tickers"
    async with websockets.connect(url, user_agent_header=UA, max_size=None, ping_interval=None) as ws:
        hdr = ws.response.headers
        print("status", ws.response.status_code, "server", hdr.get("server"), "extensions", hdr.get_all("sec-websocket-extensions") or "none")
        books = {m: {"asks": {}, "bids": {}} for m in MARKETS}
        last_seq: dict[str, int] = {}
        snaps, incs, gaps = collections.Counter(), collections.Counter(), collections.Counter()
        inc_shapes = collections.Counter()
        early = collections.Counter()
        first_inc_step = {}
        kinds = collections.Counter()
        ticker_times = []
        samples = {}
        async for t, msg in recv_for(ws, seconds):
            frame = json.loads(msg)
            for key, val in frame.items():
                kind = key.split(".", 1)[-1] if "." in key else key
                kinds[kind] += 1
                samples.setdefault(kind, (round(t, 2), msg[:400]))
                if kind == "ob-snap":
                    m = key.split(".")[0]
                    snaps[m] += 1
                    books[m] = {"asks": {p: a for p, a in val["asks"]}, "bids": {p: a for p, a in val["bids"]}}
                    last_seq[m] = val["sequence"]
                    print(f"snap {m} at {t:.2f}s sequence {val['sequence']} asks {len(val['asks'])} bids {len(val['bids'])} asks ascending {ordered(val['asks'], True)} bids descending {ordered(val['bids'], False)} keys {sorted(val)}")
                elif kind == "ob-inc":
                    m = key.split(".")[0]
                    incs[m] += 1
                    if t < 1.0:
                        early[m] += 1
                    seq = val["sequence"]
                    if m in last_seq:
                        step = seq - last_seq[m]
                        first_inc_step.setdefault(m, step)
                        if step != 1:
                            gaps[m] += 1
                    last_seq[m] = seq
                    for side in ("asks", "bids"):
                        if side in val:
                            v = val[side]
                            nested = bool(v) and isinstance(v[0], list)
                            inc_shapes[(side, "list of pairs" if nested else "one pair", "delete" if not nested and v[1] == "" else "set")] += 1
                            for pair in (v if nested else [v]):
                                apply(books[m], side, pair)
                elif key == "global.tickers":
                    ticker_times.append(t)
        print("frame kinds", dict(kinds))
        print("snapshots per market", dict(snaps))
        print("increments per market", dict(incs), "sequence gaps", dict(gaps) or "none")
        print("first increment step after snapshot", first_inc_step)
        print("increments that arrived within 1 s of connecting, replayed with the snapshot", dict(early))
        print("increment shapes", dict(inc_shapes))
        if len(ticker_times) > 1:
            print("global.tickers intervals s", [round(b - a, 1) for a, b in zip(ticker_times, ticker_times[1:])])
        for kind, (t, sample) in samples.items():
            print(f"first {kind} at {t}s: {sample}")
        print("built book against REST depth read right after the window")
        for m in MARKETS:
            d = rest_depth(m)
            asks = sorted(books[m]["asks"].items(), key=lambda x: float(x[0]))[:10]
            bids = sorted(books[m]["bids"].items(), key=lambda x: -float(x[0]))[:10]
            same = asks == [tuple(x) for x in d["asks"][:10]] and bids == [tuple(x) for x in d["bids"][:10]]
            full = len(books[m]["asks"]) == len(d["asks"]) and len(books[m]["bids"]) == len(d["bids"])
            print(m, "top 10 both sides equal", same, "level counts ws", (len(books[m]["asks"]), len(books[m]["bids"])), "rest", (len(d["asks"]), len(d["bids"])), "equal", full)
            if not full:
                for side in ("asks", "bids"):
                    rest_side = {p: a for p, a in d[side]}
                    only_ws = sorted(set(books[m][side].items()) - set(rest_side.items()))
                    only_rest = sorted(set(rest_side.items()) - set(books[m][side].items()))
                    if only_ws or only_rest:
                        print("  ", side, "only in ws book", only_ws[:5], "only in rest", only_rest[:5])


async def subscribe_frames() -> None:
    section("B. subscribe and unsubscribe on an open socket, unknown and malformed streams, 25 s")
    async with websockets.connect(WS, user_agent_header=UA, max_size=None, ping_interval=None) as ws:
        sends = [
            (0, {"event": "subscribe", "streams": ["adausdt.ob-inc"]}),
            (4, {"event": "subscribe", "streams": ["nosuchusdt.ob-inc"]}),
            (7, {"event": "subscribe", "streams": ["adausdt.ob-snap"]}),
            (10, {"event": "unsubscribe", "streams": ["adausdt.ob-inc"]}),
            (13, {"event": "nosuch"}),
            (16, "not json"),
            (19, {"event": "subscribe", "streams": ["ADAUSDT.ob-inc"]}),
        ]
        t0 = time.monotonic()

        async def sender():
            for at, frame in sends:
                await asyncio.sleep(max(0, at - (time.monotonic() - t0)))
                text = frame if isinstance(frame, str) else json.dumps(frame)
                print(f"send at {time.monotonic() - t0:.1f}s: {text}")
                await ws.send(text)

        task = asyncio.create_task(sender())
        async for t, msg in recv_for(ws, 25):
            print(f"recv at {time.monotonic() - t0:.1f}s: {msg[:220]}")
        await task


async def keepalive(idle: float = 120) -> None:
    section(f"C. keepalive: client ping, text ping, then {idle:.0f} s idle with no client pings")
    async with websockets.connect(WS + "?stream=btcusdt.ob-inc", user_agent_header=UA, max_size=None, ping_interval=None) as ws:
        t = time.monotonic()
        pong = await ws.ping()
        await asyncio.wait_for(pong, 10)
        print("protocol ping answered in", round((time.monotonic() - t) * 1000), "ms")
        replay = []
        async for t2, msg in recv_for(ws, 1.5):
            frame = json.loads(msg)
            if "btcusdt.ob-snap" in frame:
                print("snapshot sequence", frame["btcusdt.ob-snap"]["sequence"])
            elif "btcusdt.ob-inc" in frame:
                replay.append(frame["btcusdt.ob-inc"]["sequence"])
            else:
                print("frame:", msg[:120])
        print("increments right after the snapshot, sequences", replay)
        await ws.send("ping")
        async for t2, msg in recv_for(ws, 3):
            print("after text ping:", msg[:120])
        t0 = time.monotonic()
        frames = 0
        try:
            while time.monotonic() - t0 < idle:
                try:
                    await asyncio.wait_for(ws.recv(), idle - (time.monotonic() - t0))
                    frames += 1
                except asyncio.TimeoutError:
                    break
            print("socket still open after", round(time.monotonic() - t0), "s idle, data frames seen", frames)
        except websockets.ConnectionClosed as e:
            print("server closed after", round(time.monotonic() - t0), "s", "code", e.rcvd.code if e.rcvd else None, "reason", e.rcvd.reason if e.rcvd else None)


async def main() -> None:
    await books_by_url()
    await subscribe_frames()
    await keepalive()


if __name__ == "__main__":
    asyncio.run(main())
