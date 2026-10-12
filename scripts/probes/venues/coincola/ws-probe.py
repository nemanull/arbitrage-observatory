# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""CoinCola public spot WebSocket probe for docs/profiles/coincola/.

CoinCola documents no WebSocket, so this is the socket its spot trading page opens without a login.
Read-only and unauthenticated, about 5 minutes of sockets in total.
Run 1 used 60 s, 150 s, 40 s, 4 s and 6 s windows in sections A, B, C, D and F, an ETH_USDT book in section B and other pairs in section D, and run 2 the values below.
Run from the repository root with: uv run scripts/probes/venues/coincola/ws-probe.py
"""

import asyncio
import collections
import functools
import json
import statistics
import time
import urllib.request

import websockets

print = functools.partial(print, flush=True)  # noqa: A001, so output reaches a redirected file as it happens

WS_URL = "wss://www.coincola.stream/ws"  # WEB_SOCKET_IP and WEB_SOCKET_PORT from the page's runtimeConfig, plus /ws
ORIGIN = "https://www.coincola.com"
REST = "https://api.coincola.com"
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
MULTI = ["BTC_USDT", "ETH_USDT", "SOL_USDT", "DOGE_USDT", "ETH_BTC"]


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def rest_book(pair: str, depth: int = 40) -> dict:
    url = f"{REST}/v1/market/orderbook?market_pair={pair}&level=2&depth={depth}"
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=20) as r:
        return json.loads(r.read())


def depth_sub(symbol: str, levels: int = 20, precision: int = 2, event: str = "subscribe") -> str:
    # the exact frame the web client's market_depth channel sends
    return json.dumps({"channel": "market_depth", "event": event, "symbol": symbol, "levels": levels, "price_precision": precision})


def connect():
    return websockets.connect(WS_URL, user_agent_header=UA, origin=ORIGIN, max_size=None, ping_interval=None)


async def recv_for(ws, seconds: float):
    t0 = time.monotonic()
    while (left := seconds - (time.monotonic() - t0)) > 0:
        try:
            msg = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            return
        except websockets.ConnectionClosed as e:
            print(f"closed at {time.monotonic() - t0:.1f} s code {e.code} reason {e.reason!r}")
            return
        yield time.monotonic() - t0, msg


def trim(msg: str, n: int = 300) -> str:
    return msg if len(msg) <= n else msg[:n] + f"... ({len(msg)} chars)"


def shape(d: dict) -> str:
    data = d.get("data")
    keys = sorted(data.keys()) if isinstance(data, dict) else type(data).__name__
    return f"top keys {sorted(d.keys())} data keys {keys}"


def sorted_ok(levels: list, desc: bool) -> bool:
    p = [float(x[0]) for x in levels]
    return p == sorted(p, reverse=desc)


async def main_depth() -> None:
    section("A. handshake, market_depth BTC_USDT levels 20 precision 2, 45 s, answering pong with ping as the web client does")
    async with connect() as ws:
        h = ws.response.headers
        print("status", ws.response.status_code, "server", h.get("server"), "via", h.get("via"), "pop", h.get("x-amz-cf-pop"))
        print("extensions", h.get_all("sec-websocket-extensions"))
        await ws.send(depth_sub("BTC_USDT"))
        sub_at = time.monotonic()
        books, times, pongs, other = [], [], [], []
        async for t, msg in recv_for(ws, 45):
            d = json.loads(msg)
            if d.get("event") == "pong":
                pongs.append(round(t, 1))
                await ws.send(json.dumps({"event": "ping"}))
                if len(pongs) == 1:
                    print("first keepalive frame:", msg)
                continue
            if d.get("channel") == "market_depth":
                if not books:
                    print(f"first depth frame after {time.monotonic() - sub_at:.2f} s:", trim(msg, 260))
                    print("frame", shape(d))
                    print("non-book fields:", {k: v for k, v in d.items() if k != "data"}, {k: v for k, v in d["data"].items() if k not in ("asks", "bids")})
                books.append(d["data"])
                times.append(t)
            else:
                other.append(msg)
        print("depth frames", len(books), "pong frames", len(pongs), "at s", pongs[:12])
        gaps = [b - a for a, b in zip(times, times[1:])]
        if gaps:
            print(f"gap between depth frames s: min {min(gaps):.2f} median {statistics.median(gaps):.2f} max {max(gaps):.2f}")
        identical = sum(1 for a, b in zip(books, books[1:]) if a == b)
        print("frames identical to the previous one", identical, "of", max(len(books) - 1, 0))
        sizes = collections.Counter((len(b["asks"]), len(b["bids"])) for b in books)
        print("(asks, bids) level counts seen", dict(sizes))
        print("asks ascending on every frame", all(sorted_ok(b["asks"], False) for b in books))
        print("bids descending on every frame", all(sorted_ok(b["bids"], True) for b in books))
        print("level element types", {type(x).__name__ for b in books[:1] for x in b["asks"][0]}, "zero sizes seen", any(float(x[1]) == 0 for b in books for x in b["asks"] + b["bids"]))
        print("other frames", len(other), [trim(m, 160) for m in other[:3]])
        r = rest_book("BTC_USDT")
        if books:
            last = books[-1]
            print("ws best ask/bid", last["asks"][0], last["bids"][0], "rest best ask/bid", r["asks"][0], r["bids"][0])
            print("ws levels 1 to 5 prices equal REST", [x[0] for x in last["asks"][:5]] == [f"{p:.2f}" for p, _ in r["asks"][:5]])


async def silence() -> None:
    section("B. silence: subscribe BTC_USDT and never send anything else for 100 s")
    async with connect() as ws:
        await ws.send(depth_sub("BTC_USDT"))
        pongs, depth = [], []
        async for t, msg in recv_for(ws, 100):
            d = json.loads(msg)
            if d.get("event") == "pong":
                pongs.append(round(t, 1))
            elif d.get("channel") == "market_depth":
                depth.append(t)
        per30 = collections.Counter(int(t // 30) * 30 for t in depth)
        print("keepalive frames at s", pongs, "depth frames", len(depth), "per 30 s window from", dict(sorted(per30.items())))
        print("first and last depth frame at s", round(depth[0], 1) if depth else None, round(depth[-1], 1) if depth else None, "socket state at end", ws.state.name)


async def channels() -> None:
    section("C. other public channels, 25 s on one socket")
    async with connect() as ws:
        subs = [
            {"channel": "ticker", "event": "subscribe", "symbol": "BTC_USDT"},
            {"channel": "ticker", "event": "subscribe", "quote_currency": "USDT"},
            {"channel": "trade", "event": "subscribe", "symbol": "BTC_USDT"},
            {"channel": "kline", "event": "subscribe", "interval": "ONE_MINUTE", "symbol": "BTC_USDT"},
        ]
        for s in subs:
            await ws.send(json.dumps(s))
        seen = collections.Counter()
        first = {}
        async for t, msg in recv_for(ws, 25):
            d = json.loads(msg)
            if d.get("event") == "pong":
                await ws.send(json.dumps({"event": "ping"}))
                continue
            data = d.get("data") if isinstance(d.get("data"), dict) else {}
            key = (d.get("channel"), "quote" if "quote_currency" in data else "symbol")
            seen[key] += 1
            first.setdefault(key, trim(msg, 360))
        print("frames per (channel, scope)", dict(seen))
        for k, v in first.items():
            print(k, v)


async def errors() -> None:
    section("D. unknown symbol, odd levels and precision on BTC_USDT, unknown channel, malformed JSON, 6 s each")
    async with connect() as ws:
        probes = [
            depth_sub("NOPE_USDT"),
            depth_sub("btc_usdt"),
            depth_sub("BTC_USDT", levels=7),
            depth_sub("BTC_USDT", precision=9),
            json.dumps({"channel": "nope", "event": "subscribe", "symbol": "BTC_USDT"}),
            "not json",
        ]
        for p in probes:
            await ws.send(p)
            print("sent", p)
            async for t, msg in recv_for(ws, 6):
                d = json.loads(msg)
                if d.get("event") == "pong":
                    continue
                data = d.get("data") if isinstance(d.get("data"), dict) else {}
                print(f"  {t:.1f} s", d.get("channel"), d.get("event"), "asks", len(data.get("asks", [])), "bids", len(data.get("bids", [])), trim(msg, 200))
                break
            else:
                print("  no reply within 6 s")
        print("socket state after malformed frame", ws.state.name)


async def multi() -> None:
    section("E. five market_depth subscriptions on one socket, 30 s, then unsubscribe BTC_USDT for 12 s")
    async with connect() as ws:
        for s in MULTI:
            await ws.send(depth_sub(s, precision=2 if s.endswith("USDT") else 6))
        counts = collections.Counter()
        first = {}
        async for t, msg in recv_for(ws, 30):
            d = json.loads(msg)
            if d.get("event") == "pong":
                await ws.send(json.dumps({"event": "ping"}))
            elif d.get("channel") == "market_depth":
                sym = d["data"].get("symbol") or d.get("symbol") or best_price_bucket(d["data"])
                counts[sym] += 1
                first.setdefault(sym, round(t, 1))
        print("depth frames by symbol, or by best ask when the frame names none", dict(counts))
        print("first frame after s", first, "never", [s for s in MULTI if s not in first])
        await ws.send(depth_sub("BTC_USDT", event="unsubscribe"))
        counts.clear()
        async for t, msg in recv_for(ws, 12):
            d = json.loads(msg)
            if d.get("channel") == "market_depth":
                counts[d["data"].get("symbol") or d.get("symbol") or best_price_bucket(d["data"])] += 1
        print("after unsubscribe", dict(counts))


def best_price_bucket(data: dict) -> str:
    a = data.get("asks") or [["0"]]
    return f"best ask {a[0][0]}"


async def depths() -> None:
    section("F. levels 10, 50, 100, 200 and precision 0 and 1 on BTC_USDT, 8 s each")
    for levels, prec in [(10, 2), (50, 2), (100, 2), (200, 2), (20, 0), (20, 1)]:
        async with connect() as ws:
            await ws.send(depth_sub("BTC_USDT", levels, prec))
            got = None
            async for t, msg in recv_for(ws, 8):
                d = json.loads(msg)
                if d.get("channel") == "market_depth":
                    got = d["data"]
                    got_at = t
                    break
            if got:
                print(f"levels {levels} precision {prec}: asks {len(got['asks'])} bids {len(got['bids'])} best ask {got['asks'][0] if got['asks'] else None} echo {got.get('levels')} {got.get('price_precision')} frame bytes {len(json.dumps(got))} after {got_at:.1f} s")
            else:
                print(f"levels {levels} precision {prec}: no depth frame in 8 s")


async def main() -> None:
    print("probe start UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    await main_depth()
    await silence()
    await channels()
    await errors()
    await multi()
    await depths()
    print("\nprobe end UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
