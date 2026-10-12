# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only Socket.IO probe for IndoEx.

The documented public socket is `https://websocket.indoex.io/`, a Socket.IO server joined with `join {pair}`.
The website's own bundle connects to `https://socket.indoex.io/` and `https://proxysocket.indoex.io/` instead.
For each host this probe runs the Engine.IO polling handshake, then opens the WebSocket transport,
emits the documented `join` for two listed pairs and one unlisted pair, then the bundle's `setmycombinations`, answers the Engine.IO ping, and records every event name,
its payload shape and its timing for a fixed window.
Last it opens one silent socket that offers permessage-deflate and sends no ping.
Run from the repository root: uv run scripts/probes/venues/indoex/ws-probe.py [seconds-per-host]
"""

import asyncio
import collections
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/indoex")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
HOSTS = ["websocket.indoex.io", "socket.indoex.io", "proxysocket.indoex.io"]
PAIRS = ["BTC_USDT", "ETH_USDT", "NOPE_USDT"]  # the last one is not listed, to see what an unknown pair returns
WINDOW = int(sys.argv[1]) if len(sys.argv) > 1 else 90


def polling_handshake(host: str) -> None:
    url = f"https://{host}/socket.io/?EIO=3&transport=polling&t={int(time.time() * 1000)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    started = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=20) as reply:
            status, body = reply.status, reply.read()
    except urllib.error.HTTPError as error:
        status, body = error.code, error.read()
    except Exception as error:  # noqa: BLE001
        status, body = None, repr(error).encode()
    print(f"polling handshake {url.split('&t=')[0]}: {status} in {(time.monotonic() - started) * 1000:.0f} ms, body {body[:160]!r}")


def shape(value, depth: int = 0):
    if depth > 2:
        return type(value).__name__
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in list(value.items())[:12]}
    if isinstance(value, list):
        return [len(value), shape(value[0], depth + 1)] if value else []
    return type(value).__name__


async def watch(host: str) -> None:
    print(f"\n== {host}, window {WINDOW} s, run at {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    polling_handshake(host)
    url = f"wss://{host}/socket.io/?EIO=3&transport=websocket"
    counts: collections.Counter = collections.Counter()
    first: dict[str, str] = {}
    times: dict[str, list[float]] = collections.defaultdict(list)
    log = (WORK / f"ws-{host}.log").open("w")
    try:
        started = time.monotonic()
        async with websockets.connect(
            url, ssl=ssl.create_default_context(), compression=None, user_agent_header=UA, open_timeout=20, ping_interval=None
        ) as ws:
            print(f"websocket open in {(time.monotonic() - started) * 1000:.0f} ms, response headers {list(ws.response.headers.raw_items())}")
            ping_every = 25.0
            last_ping = time.monotonic()
            pongs = 0
            joined = False
            deadline = time.monotonic() + WINDOW
            while time.monotonic() < deadline:
                if time.monotonic() - last_ping >= ping_every:
                    await ws.send("2")
                    last_ping = time.monotonic()
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                now = time.monotonic() - started
                text = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
                log.write(f"{now:8.3f} {text[:2000]}\n")
                kind = text[:1]
                if text.startswith("0{"):
                    info = json.loads(text[1:])
                    ping_every = info.get("pingInterval", 25000) / 1000
                    print(f"engine.io open at {now:.2f} s: {info}")
                elif text == "40":
                    print(f"socket.io connect at {now:.2f} s")
                    if not joined:
                        frames = [["join", {"pair": pair}] for pair in PAIRS]
                        # the site bundle's own subscription, with combinations spelled vendor-market
                        frames.append(["setmycombinations", {"myordercombination": [p.replace("_", "-") for p in PAIRS]}])
                        for event in frames:
                            frame = "42" + json.dumps(event)
                            await ws.send(frame)
                            print(f"sent {frame}")
                        joined = True
                elif text == "3":
                    pongs += 1
                elif text.startswith("42"):
                    event = json.loads(text[2:])
                    name = event[0]
                    counts[name] += 1
                    times[name].append(now)
                    if name not in first:
                        first[name] = text[:600]
                        payload = event[1] if len(event) > 1 else None
                        print(f"first {name!r} at {now:.2f} s, {len(text)} bytes, shape {json.dumps(shape(payload))[:400]}")
                else:
                    counts[f"engine.io type {kind}"] += 1
                    print(f"other frame at {now:.2f} s: {text[:200]!r}")
            print(f"closed by probe after {time.monotonic() - started:.1f} s, pongs {pongs}")
    except Exception as error:  # noqa: BLE001
        print(f"websocket error: {error!r}")
    finally:
        log.close()
    print(f"event counts: {dict(counts)}")
    for name, stamps in times.items():
        gaps = [b - a for a, b in zip(stamps, stamps[1:])]
        if gaps:
            print(f"  {name}: median gap {sorted(gaps)[len(gaps) // 2]:.2f} s, max gap {max(gaps):.2f} s")
    for name, text in first.items():
        print(f"  sample {name}: {text[:600]}")


async def silence(host: str, limit: float = 45.0) -> None:
    """Offers permessage-deflate, then never pings, to see the extension reply and how long the server waits."""
    print(f"\n== silence on {host}, up to {limit:.0f} s, no Engine.IO pings sent")
    url = f"wss://{host}/socket.io/?EIO=3&transport=websocket"
    started = time.monotonic()
    try:
        async with websockets.connect(url, ssl=ssl.create_default_context(), user_agent_header=UA, open_timeout=20, ping_interval=None) as ws:
            extensions = ws.response.headers.get_all("Sec-WebSocket-Extensions")
            print(f"offered permessage-deflate, server Sec-WebSocket-Extensions {extensions or 'absent'}")
            while time.monotonic() - started < limit:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=limit - (time.monotonic() - started))
                    print(f"  {time.monotonic() - started:6.2f} s: {str(raw)[:120]}")
                except asyncio.TimeoutError:
                    break
            print(f"still open after {time.monotonic() - started:.1f} s, closing")
    except websockets.ConnectionClosed as closed:
        print(f"closed by server at {time.monotonic() - started:.2f} s, code {closed.rcvd.code if closed.rcvd else None}, reason {closed.rcvd.reason if closed.rcvd else None!r}")
    except Exception as error:  # noqa: BLE001
        print(f"error at {time.monotonic() - started:.2f} s: {error!r}")


async def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    for host in HOSTS:
        await watch(host)
    await silence("socket.indoex.io")


if __name__ == "__main__":
    asyncio.run(main())
