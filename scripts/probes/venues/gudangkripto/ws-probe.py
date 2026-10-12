# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Read-only probe of GudangKripto's public WebSocket, wss://be.gudangkripto.id/ws.

Public, unauthenticated and read-only.
GudangKripto publishes no socket documentation.
The URL comes from the web app's runtime config (wsUrl), and the frame shapes from its socket client in the entry chunk.
The app sends {"action":"subscribe","channels":[...]} and {"action":"ping"} every 30 s, and builds channels as market:IDR, ticker:<COIN>_IDR, orderbook:<COIN>_IDR and trades:<COIN>_IDR.
Sockets are held one at a time, about 4 minutes of wall time in all:
  handshake  the upgrade response headers, including whether the permessage-deflate offer is accepted
  book       90 s on orderbook, ticker and trades for BTC_IDR, USDT_IDR and ETH_IDR plus market:IDR and depth:BTC_IDR, with an app ping every 30 s
  errors     an app ping, an unknown symbol, an unknown action, a non-JSON frame, a bare string channel and an unsubscribe
  wide       40 s subscribed to the orderbook of every coin in /api/core/coin on one socket
  silence    60 s with no subscription and no app ping, to see whether the server closes an idle socket
  all        every part above, in order
Run from the repository root with: uv run scripts/probes/venues/gudangkripto/ws-probe.py [part]
Captured frames go to .claude/survey-work/gudangkripto/ws-capture.jsonl.
"""

import asyncio
import json
import pathlib
import statistics
import sys
import time
import urllib.request

import websockets

URL = "wss://be.gudangkripto.id/ws"
HEADERS = {"user_agent_header": "Mozilla/5.0 (survey probe)", "origin": "https://gudangkripto.id"}
CAPTURE = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "gudangkripto" / "ws-capture.jsonl"
PAIRS = ["BTC_IDR", "USDT_IDR", "ETH_IDR"]


def log(part: str, direction: str, frame: str) -> None:
    CAPTURE.parent.mkdir(parents=True, exist_ok=True)
    with CAPTURE.open("a") as fh:
        fh.write(json.dumps({"t": round(time.time(), 3), "part": part, "dir": direction, "frame": frame[:4000]}) + "\n")


async def send(ws, part: str, obj) -> None:
    text = obj if isinstance(obj, str) else json.dumps(obj)
    log(part, "out", text)
    await ws.send(text)


async def handshake() -> None:
    print("## handshake")
    async with websockets.connect(URL, ping_interval=None, **HEADERS) as ws:
        h = ws.response.headers
        print(f"HTTP {ws.response.status_code}, Sec-WebSocket-Extensions {h.get('Sec-WebSocket-Extensions')!r}, Server {h.get('Server')}, CF-RAY {h.get('CF-RAY')}")
        print(f"Server-Timing {h.get_all('Server-Timing')}, Access-Control-Allow-Origin {h.get('Access-Control-Allow-Origin')}")
        print("permessage-deflate was offered by the client and", "accepted" if h.get("Sec-WebSocket-Extensions") else "not accepted")


def levels_ok(side: list, descending: bool) -> bool:
    prices = [float(x["price"]) for x in side]
    return prices == sorted(prices, reverse=descending)


async def book() -> None:
    print("## book")
    channels = ["market:IDR", "depth:BTC_IDR"] + [f"{kind}:{p}" for p in PAIRS for kind in ("orderbook", "ticker", "trades")]
    arrivals: dict[str, list[float]] = {}
    books: dict[str, list[dict]] = {}
    ticker_ts_skew = []
    market_assets = None
    other: dict[str, int] = {}
    first_at: dict[str, float] = {}
    async with websockets.connect(URL, ping_interval=None, max_size=2**23, **HEADERS) as ws:
        t0 = time.time()
        await send(ws, "book", {"action": "subscribe", "channels": channels})
        next_ping = t0 + 30
        while time.time() - t0 < 90:
            if time.time() >= next_ping:
                await send(ws, "book", {"action": "ping"})
                next_ping += 30
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, next_ping - time.time()))
            except asyncio.TimeoutError:
                continue
            now = time.time()
            msg = json.loads(raw)
            key = msg.get("channel") or ("market:IDR" if msg.get("type") == "ticker" and isinstance(msg.get("data"), dict) and "assets" in msg["data"] else f"type {msg.get('type')} without channel")
            if key not in arrivals:
                first_at[key] = now - t0
            arrivals.setdefault(key, []).append(now)
            if len(arrivals[key]) <= 2:
                log("book", "in", raw)
            if msg.get("type") == "orderbook":
                books.setdefault(key, []).append({"t": now, **msg["data"]})
            elif key == "market:IDR":
                market_assets = msg["data"]["assets"]
                ticker_ts_skew.append(now * 1000 - msg["data"]["ts"])
            elif msg.get("type") not in ("ticker", "trades"):
                other[raw] = other.get(raw, 0) + 1
                log("book", "in", raw)
    for key, ts in sorted(arrivals.items()):
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        g = f", gap median {statistics.median(gaps):.2f} s, max {max(gaps):.2f} s" if gaps else ""
        print(f"{key}: {len(ts)} messages, first {first_at[key]:.3f} s after the subscribe frame{g}")
    for key, snaps in books.items():
        first = snaps[0]
        sizes = sorted({(len(s["bids"]), len(s["asks"])) for s in snaps})
        changed = sum(1 for a, b in zip(snaps, snaps[1:]) if (a["bids"], a["asks"]) != (b["bids"], b["asks"]))
        ordered = all(levels_ok(s["bids"], True) and levels_ok(s["asks"], False) for s in snaps)
        crossed = sum(1 for s in snaps if s["bids"] and s["asks"] and float(s["bids"][0]["price"]) >= float(s["asks"][0]["price"]))
        ts_monotonic = all(b["ts"] > a["ts"] for a, b in zip(snaps, snaps[1:]))
        lag = [s["t"] * 1000 - s["ts"] for s in snaps]
        print(f"{key}: {len(snaps)} frames, bid and ask level counts {sizes}, frames differing from the one before {changed}, bids descending and asks ascending in every frame {ordered}, crossed frames {crossed}, ts strictly increasing {ts_monotonic}")
        print(f"  keys {list(first.keys())}, level keys {list(first['bids'][0].keys()) if first['bids'] else None}, local receive minus ts ms median {statistics.median(lag):.0f}")
        if first["bids"] and first["asks"]:
            bb, ba = float(first["bids"][0]["price"]), float(first["asks"][0]["price"])
            print(f"  first frame best bid {first['bids'][0]}, best ask {first['asks'][0]}, spread {(ba - bb) / ((ba + bb) / 2) * 1e6:.0f} ppm of mid")
    if market_assets is not None:
        print(f"market:IDR assets per frame {len(market_assets)}: {', '.join(a['coin'] for a in market_assets)}")
        print(f"market:IDR asset keys {list(market_assets[0].keys())}, local receive minus ts ms median {statistics.median(ticker_ts_skew):.0f}")
    print(f"depth:BTC_IDR delivered {len(arrivals.get('depth:BTC_IDR', []))} frames")
    for raw, n in other.items():
        print(f"other frame seen {n} times, identical each time: {raw[:400]}")


async def collect(ws, part: str, seconds: float) -> list[str]:
    out = []
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
        except asyncio.TimeoutError:
            break
        msg = json.loads(raw) if raw.startswith("{") else {}
        if msg.get("type") not in ("ticker", "trades", "orderbook"):
            out.append(raw)
            log(part, "in", raw)
    return out


async def errors() -> None:
    print("## errors")
    probes = [
        {"action": "ping"},
        {"action": "subscribe", "channels": ["orderbook:NOPE_IDR"]},
        {"action": "subscribe", "channels": ["orderbook:BTC_USDT"]},
        {"action": "subscribe", "channels": ["depth:BTC_IDR"]},
        {"action": "hello"},
        "not json",
        {"action": "subscribe", "channels": "orderbook:BTC_IDR"},
        {"action": "unsubscribe", "channels": ["orderbook:NOPE_IDR"]},
    ]
    async with websockets.connect(URL, ping_interval=None, **HEADERS) as ws:
        for p in probes:
            await send(ws, "errors", p)
            replies = await collect(ws, "errors", 4)
            print(f"sent {json.dumps(p) if not isinstance(p, str) else repr(p)}")
            for r in replies:
                print(f"  got {r[:300]}")
            if not replies:
                print("  no reply within 4 s")
        print(f"socket still open after the error frames: {ws.state.name}")
    async with websockets.connect(URL, ping_interval=None, **HEADERS) as ws:
        await send(ws, "errors", {"action": "subscribe", "channels": ["orderbook:NOPE_IDR"]})
        frames = []
        end = time.time() + 20
        while time.time() < end:
            try:
                frames.append(await asyncio.wait_for(ws.recv(), timeout=end - time.time()))
            except asyncio.TimeoutError:
                break
        print(f"20 s on orderbook:NOPE_IDR alone: {len(frames)} frames, types {[json.loads(f).get('type') for f in frames]}")


async def wide() -> None:
    print("## wide")
    with urllib.request.urlopen(urllib.request.Request("https://be.gudangkripto.id/api/core/coin", headers={"User-Agent": "Mozilla/5.0 (survey probe)"}), timeout=25) as r:
        coins = [c["coin"] for c in json.loads(r.read())["data"]]
    channels = [f"orderbook:{c}_IDR" for c in coins]
    seen: dict[str, list] = {}
    async with websockets.connect(URL, ping_interval=None, max_size=2**23, **HEADERS) as ws:
        await send(ws, "wide", {"action": "subscribe", "channels": channels})
        end = time.time() + 40
        before_ack = 0
        acked = False
        while time.time() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=end - time.time()))
            except asyncio.TimeoutError:
                break
            if msg.get("type") == "subscribed":
                acked = True
                print(f"ack after {before_ack} orderbook frames, channels echoed {len(msg['data']['channels'])} of {len(channels)}")
            if msg.get("type") == "orderbook":
                before_ack += 0 if acked else 1
                d = msg["data"]
                seen.setdefault(msg["channel"], []).append((len(d["bids"]), len(d["asks"])))
    print(f"{len(seen)} of {len(channels)} orderbook channels sent at least one frame in 40 s, {sum(len(v) for v in seen.values())} frames in all")
    silent = sorted(set(channels) - set(seen))
    print(f"silent channels: {', '.join(silent) if silent else 'none'}")
    for ch, v in sorted(seen.items()):
        print(f"  {ch}: {len(v)} frames, level counts {sorted(set(v))}")


async def silence() -> None:
    print("## silence")
    t0 = time.time()
    async with websockets.connect(URL, ping_interval=None, **HEADERS) as ws:
        try:
            while time.time() - t0 < 60:
                raw = await asyncio.wait_for(ws.recv(), timeout=60 - (time.time() - t0))
                log("silence", "in", raw)
                print(f"  {time.time() - t0:.1f} s frame {raw[:200]}")
        except asyncio.TimeoutError:
            print(f"no frame and no close in 60 s with no subscription and no app ping, state {ws.state.name}")
        except websockets.ConnectionClosed as e:
            print(f"closed after {time.time() - t0:.1f} s with code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None!r}")


PARTS = {"handshake": handshake, "book": book, "errors": errors, "wide": wide, "silence": silence}

if __name__ == "__main__":
    part = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"started {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    for name, fn in PARTS.items():
        if part in (name, "all"):
            asyncio.run(fn())
