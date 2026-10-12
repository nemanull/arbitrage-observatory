# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""NexDAX socket probe for docs/profiles/nexdax/websocket.md.

Public, unauthenticated and read-only.
NexDAX publishes no socket documentation, and its web app is geoblocked from this host, so this probe only maps what the server at socket.nexdax.com answers.
It holds sockets for about 100 s of wall time, in this order:
  A. Engine.IO handshakes with EIO=4 and EIO=3, and the HTTP polling transport.
  B. Socket.IO namespaces other than the default one.
  C. 203 guessed subscribe events with acknowledgement ids, then 12 s of listening.
  D. Three client pings, and their answers.
  E. 70 s on two sockets at once, one that never pings and one that pings every 20 s.
  F. Plain WebSocket paths on both hosts.
Run from the repository root with: uv run scripts/probes/venues/nexdax/ws-probe.py
"""

import asyncio
import json
import time
import urllib.error
import urllib.request

import websockets

HOST = "socket.nexdax.com"
URL4 = f"wss://{HOST}/socket.io/?EIO=4&transport=websocket"
URL3 = f"wss://{HOST}/socket.io/?EIO=3&transport=websocket"
NAMES = ["subscribe", "sub", "join", "joinRoom", "join_room", "subscribeOrderbook", "subscribeDepth", "orderbook",
         "depth", "ticker", "market", "trade", "trades", "kline", "pair", "symbol", "SUBSCRIBE", "listen", "watch",
         "room", "exchange", "subscribeMarket", "subscribeSymbol", "subscribeTicker", "changeSymbol", "change_symbol",
         "setSymbol", "selectPair", "marketData"]
ARGS = ["BTCUSDT", "BTC_USDT", "btcusdt@depth", "depth_BTCUSDT", {"symbol": "BTCUSDT"}, {"pair": "BTC_USDT"},
        {"method": "SUBSCRIBE", "params": ["btcusdt@depth"], "id": 1}]


async def connect(url):
    t0 = time.perf_counter()
    ws = await websockets.connect(url, open_timeout=20, ping_interval=None, compression=None, max_size=None)
    return ws, (time.perf_counter() - t0) * 1000


async def recv_until(ws, seconds, limit=40):
    """Collect frames for a number of seconds, answering nothing."""
    out, t0 = [], time.time()
    while time.time() - t0 < seconds:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=seconds - (time.time() - t0))
        except asyncio.TimeoutError:
            break
        out.append((round(time.time() - t0, 2), m))
        if len(out) >= limit:
            break
    return out


async def handshakes():
    print("== A. handshakes")
    for url in (URL4, URL3):
        ws, ms = await connect(url)
        open_frame = await ws.recv()
        await ws.send("40")
        rest = await recv_until(ws, 3)
        print(url, "connect ms", round(ms), "open", open_frame, "then", [m for _, m in rest])
        await ws.close()
    for eio in (4, 3):
        req = urllib.request.Request(f"https://{HOST}/socket.io/?EIO={eio}&transport=polling",
                                     headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                print("polling EIO", eio, r.status, r.read()[:120])
        except urllib.error.HTTPError as e:
            print("polling EIO", eio, e.code, e.read()[:120])


async def namespaces():
    print("\n== B. namespaces")
    ws, _ = await connect(URL3)
    await ws.recv()
    await ws.recv()
    for ns in ("/market", "/exchange", "/public"):
        await ws.send(f"40{ns},")
    for t, m in await recv_until(ws, 4):
        print(t, m)
    await ws.close()


async def guesses():
    print("\n== C. guessed subscribe events")
    ws, _ = await connect(URL4)
    await ws.recv()
    await ws.send("40")
    await ws.recv()
    n = 0
    for name in NAMES:
        for arg in ARGS:
            n += 1
            await ws.send(f"42{n}" + json.dumps([name, arg]))
    print("sent", n, "event frames with ack ids, for example", f"42{n}" + json.dumps([NAMES[-1], ARGS[-1]]))
    frames = await recv_until(ws, 12)
    print("frames received in 12 s", len(frames), [m[:120] for _, m in frames[:10]])
    print("\n== D. client pings")
    for i in range(3):
        t0 = time.perf_counter()
        await ws.send("2")
        m = await asyncio.wait_for(ws.recv(), timeout=10)
        print("ping", i, "answer", repr(m), "ms", round((time.perf_counter() - t0) * 1000))
        await asyncio.sleep(2)
    await ws.close()


async def lifetime(label, ping_every):
    ws, _ = await connect(URL3)
    t0 = time.time()
    await ws.recv()
    await ws.send("40")
    next_ping = ping_every
    frames = []
    while time.time() - t0 < 70:
        if ping_every and time.time() - t0 >= next_ping:
            await ws.send("2")
            next_ping += ping_every
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=1)
            frames.append((round(time.time() - t0, 1), m))
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as e:
            print(label, "closed at", round(time.time() - t0, 1), "s", "code", e.rcvd.code if e.rcvd else None,
                  "frames", frames)
            return
    print(label, "still open at 70 s, frames", frames)
    await ws.close()


async def plain_paths():
    print("\n== F. plain WebSocket paths")
    for url in ("wss://api.nexdax.com/ws", f"wss://{HOST}/ws", "wss://api.nexdax.com/stream"):
        try:
            ws, _ = await connect(url)
            print(url, "opened")
            await ws.close()
        except Exception as e:
            print(url, type(e).__name__, str(e)[:120])


async def main():
    await handshakes()
    await namespaces()
    await guesses()
    print("\n== E. lifetime, 70 s")
    await asyncio.gather(lifetime("no client ping", 0), lifetime("ping every 20 s", 20))
    await plain_paths()


if __name__ == "__main__":
    asyncio.run(main())
