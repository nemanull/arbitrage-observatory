# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""COINSPACE WebSocket probe for docs/profiles/coinspace/websocket.md.

Public, unauthenticated and read-only.
The socket is the Socket.IO server the www.coinspace.world web app opens at api.coinspace.world.
The app's trade page takes its book from Binance USD-M futures instead, so part G opens that URL for comparison.
It holds sockets open for about 2.5 minutes of wall time, one at a time:
  A. The Engine.IO polling handshake, for the ping interval and timeout.
  B. 60 s on the default namespace and the /market namespace with no login, answering pings, to see what is broadcast.
  C. 15 s after a subscribe frame for each advertised or guessed channel name on both namespaces, to see whether any market data arrives.
  D. An authenticate frame with an empty token, for the error shape.
  E. The permessage-deflate offer, to see whether the server accepts compression.
  F. 40 s with no ping answers, to see when the server closes.
  G. 10 s of the Binance depth stream URL the trade page builds, wss://fstream.binance.com/public/ws/btcusdt@depth.
  H. A plain WebSocket upgrade at the root and at /ws, the URLs of the trade page's CTR/USDT chart code and of a dev build constant.
Run from the repository root with: uv run scripts/probes/venues/coinspace/ws-probe.py
Captured frames go to .claude/survey-work/coinspace/ws-capture.jsonl.
"""

import asyncio
import json
import pathlib
import time
import urllib.request

import websockets

HOST = "api.coinspace.world"
WS_URL = f"wss://{HOST}/socket.io/?EIO=4&transport=websocket"
BINANCE_URL = "wss://fstream.binance.com/public/ws/btcusdt@depth"
CAPTURE = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "coinspace" / "ws-capture.jsonl"
GUESSES = ["market_status", "system_notifications", "BTCUSDT", "BTC/USDT", "ticker:BTCUSDT", "orderbook:BTCUSDT", "depth:BTCUSDT", "market:BTCUSDT", "market", "ticker"]


def log(part: str, direction: str, frame: str):
    with CAPTURE.open("a") as fh:
        fh.write(json.dumps({"t": round(time.time(), 3), "part": part, "dir": direction, "frame": frame[:2000]}) + "\n")


async def recv_until(ws, part: str, seconds: float, answer_pings: bool = True):
    frames = []
    end = time.monotonic() + seconds
    while True:
        left = end - time.monotonic()
        if left <= 0:
            return frames, None
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return frames, None
        except websockets.ConnectionClosed as exc:
            return frames, f"closed code {exc.rcvd.code if exc.rcvd else None} reason {exc.rcvd.reason if exc.rcvd else ''!r}"
        frames.append((time.monotonic(), msg))
        log(part, "in", msg)
        if answer_pings and msg == "2":
            await ws.send("3")
            log(part, "out", "3")


async def open_sio(part: str, compression=None):
    ws = await websockets.connect(WS_URL, compression=compression, open_timeout=15, ping_interval=None,
                                  user_agent_header="arbitrage-observatory-probe/1.0")
    hello = await ws.recv()
    log(part, "in", hello)
    return ws, hello


def part_a():
    print("\n### A. Engine.IO polling handshake")
    req = urllib.request.Request(f"https://{HOST}/socket.io/?EIO=4&transport=polling",
                                 headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = resp.read().decode()
        print(f"HTTP {resp.status}, body {body}")
    for path in ("/ws", "/socket.io/?EIO=3&transport=polling"):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"https://{HOST}{path}", headers={"User-Agent": "probe"}), timeout=15) as r:
                print(f"GET {path}: HTTP {r.status}, {r.read(200)!r}")
        except urllib.error.HTTPError as exc:
            print(f"GET {path}: HTTP {exc.code}, {exc.read(200)!r}")


async def part_b():
    print("\n### B. Default and /market namespaces, no login, 60 s")
    ws, hello = await open_sio("B")
    print("open packet", hello)
    await ws.send("40")
    log("B", "out", "40")
    await ws.send("40/market,")
    log("B", "out", "40/market,")
    t0 = time.monotonic()
    frames, closed = await recv_until(ws, "B", 60)
    kinds = {}
    for _, f in frames:
        key = f if f in ("2", "3") else f[:40]
        kinds[key] = kinds.get(key, 0) + 1
    print(f"frames {len(frames)}, closed {closed}")
    for t, f in frames:
        if f != "2":
            print(f"  +{t - t0:5.1f}s {f[:200]}")
    pings = [t - t0 for t, f in frames if f == "2"]
    print("server pings at s", [round(p, 1) for p in pings])
    await ws.close()


async def part_c():
    print("\n### C. Subscribe guesses, 15 s")
    ws, _ = await open_sio("C")
    await ws.send("40")
    await ws.send("40/market,")
    await recv_until(ws, "C", 2)
    for ns in ("", "/market,"):
        for ch in GUESSES:
            for event in ("subscribe", "join"):
                frame = f'42{ns}{json.dumps([event, {"channels": [ch]}])}'
                await ws.send(frame)
                log("C", "out", frame)
        frame = f'42{ns}["subscribe","btcusdt@depth"]'
        await ws.send(frame)
        log("C", "out", frame)
    frames, closed = await recv_until(ws, "C", 15)
    data = [f for _, f in frames if f not in ("2", "3")]
    print(f"frames other than ping {len(data)}, closed {closed}")
    for f in data[:10]:
        print("  ", f[:200])
    await ws.close()


async def part_d():
    print("\n### D. authenticate with an empty token")
    ws, _ = await open_sio("D")
    await ws.send("40")
    await recv_until(ws, "D", 2)
    frame = '42["authenticate",{"token":"","deviceId":"probe"}]'
    await ws.send(frame)
    log("D", "out", frame)
    frames, closed = await recv_until(ws, "D", 6)
    for _, f in frames:
        print("  ", f[:300])
    print("closed", closed)
    await ws.close()


async def part_e():
    print("\n### E. permessage-deflate offer")
    ws, _ = await open_sio("E", compression="deflate")
    ext = ws.response.headers.get("Sec-WebSocket-Extensions")
    print("response Sec-WebSocket-Extensions:", ext)
    print("response headers:", {k: v for k, v in ws.response.headers.raw_items() if k.lower() in ("server", "via", "x-cache", "x-amz-cf-pop")})
    await ws.close()


async def part_f():
    print("\n### F. No ping answers, up to 60 s")
    ws, _ = await open_sio("F")
    await ws.send("40")
    t0 = time.monotonic()
    frames, closed = await recv_until(ws, "F", 60, answer_pings=False)
    print(f"server pings at s {[round(t - t0, 1) for t, f in frames if f == '2']}, closed {closed} at about {time.monotonic() - t0:.1f} s")
    await ws.close()


async def part_g():
    print("\n### G. Binance depth stream that the trade page opens, 10 s")
    try:
        async with websockets.connect(BINANCE_URL, compression=None, open_timeout=15) as ws:
            frames, closed = await recv_until(ws, "G", 10, answer_pings=False)
    except Exception as exc:  # noqa: BLE001 the outcome is what this part records
        print("connect failed:", repr(exc))
        return
    print(f"frames {len(frames)}, closed {closed}")
    if frames:
        first = json.loads(frames[0][1])
        print("first frame keys", sorted(first.keys()), "e", first.get("e"), "U", first.get("U"), "u", first.get("u"), "pu", first.get("pu"))


async def part_h():
    print("\n### H. Plain WebSocket upgrade at wss://api.coinspace.world and /ws, 8 s each")
    for url in (f"wss://{HOST}", f"wss://{HOST}/ws"):
        try:
            async with websockets.connect(url, compression=None, open_timeout=15) as ws:
                frames, closed = await recv_until(ws, "H", 8, answer_pings=False)
                print(f"{url}: opened, frames {len(frames)}, first {frames[0][1][:200] if frames else None}, closed {closed}")
        except Exception as exc:  # noqa: BLE001 the outcome is what this part records
            print(f"{url}: {exc!r}"[:300])


async def main():
    CAPTURE.parent.mkdir(parents=True, exist_ok=True)
    CAPTURE.write_text("")
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    part_a()
    await part_b()
    await part_c()
    await part_d()
    await part_e()
    await part_f()
    await part_g()
    await part_h()
    print("\nprobe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
