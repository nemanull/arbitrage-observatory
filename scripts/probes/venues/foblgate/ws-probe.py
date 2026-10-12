# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe of FOBLGATE's public stream, wss://api2.foblgate.com/rds.

FOBLGATE publishes no stream documentation.
The frames below are the ones its web app sends, read from the app's JS bundle:
{"funcName":"orderBook","pairName":"BTC/USDT","delYn":"N"} subscribes, delYn "Y" unsubscribes,
{"funcName":"PING"} every 5 s is answered with the text PONG,
and {"funcName":"chartCandle","pairName":...,"type":...} asks for candles.

Modes, all by default, or name some on the command line:
    connect   handshake status and headers, the first frame, with and without an Origin header
    watch     orderBook and publicSign for every listed pair on one socket, PING every 5 s, 180 s, frames counted by funcName
    chart     one chartCandle request for BTC/USDT, the reply trimmed
    errors    an unknown funcName, an unknown pair, a malformed frame, plain text, an unsubscribe
    idle      no PING for 120 s, to see whether the server closes a silent socket

The run holds sockets for about 6 minutes in total.

Run from the repository root:
    uv run scripts/probes/venues/foblgate/ws-probe.py [mode ...]
"""

import asyncio
import collections
import json
import sys
import time
import urllib.request
from pathlib import Path

import websockets

URL = "wss://api2.foblgate.com/rds"
ORIGIN = "https://www.foblgate.com"
WORK = Path(".claude/survey-work/foblgate")


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False), flush=True)


def trim(m) -> str:
    s = m if isinstance(m, str) else m.decode(errors="replace")
    return s if len(s) <= 400 else s[:400] + f"... ({len(s)} chars)"


async def drain(ws, seconds: float, ping_every: float | None = 5.0, log_all: bool = True) -> collections.Counter:
    counts = collections.Counter()
    t0 = last_ping = time.monotonic()
    while (left := seconds - (time.monotonic() - t0)) > 0:
        if ping_every and time.monotonic() - last_ping >= ping_every:
            await ws.send(json.dumps({"funcName": "PING"}))
            last_ping = time.monotonic()
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=min(1.0, left))
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as e:
            out(event="closed", after_s=round(time.monotonic() - t0, 1), code=e.rcvd.code if e.rcvd else None, reason=e.rcvd.reason if e.rcvd else None)
            break
        if m == "PONG":
            counts["PONG"] += 1
            continue
        try:
            arr = json.loads(m)
            key = ",".join(sorted({str(r.get("funcName")) for r in arr})) if isinstance(arr, list) else f"object:{arr.get('funcName')}"
        except (ValueError, AttributeError):
            key = "text"
        counts[key] += 1
        if log_all or counts[key] <= 2:
            out(event="frame", t=round(time.monotonic() - t0, 2), kind=key, frame=trim(m))
    return counts


async def mode_connect() -> None:
    for origin in (ORIGIN, None):
        try:
            async with websockets.connect(URL, origin=origin, open_timeout=15) as ws:
                r = ws.response
                out(mode="connect", origin=origin, status=r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() in ("server", "sec-websocket-extensions", "access-control-allow-origin")})
                first = await asyncio.wait_for(ws.recv(), timeout=10)
                out(mode="connect", origin=origin, first_frame=trim(first))
                t0 = time.perf_counter()
                await ws.send(json.dumps({"funcName": "PING"}))
                pong = await asyncio.wait_for(ws.recv(), timeout=10)
                out(mode="connect", origin=origin, ping_reply=trim(pong), rtt_ms=round((time.perf_counter() - t0) * 1000))
        except Exception as e:  # a refusal is a result
            out(mode="connect", origin=origin, error=repr(e))


def listed_pairs() -> list[str]:
    path = WORK / "marketList.json"
    if not path.exists():
        req = urllib.request.Request("https://api2.foblgate.com/ticker/marketList", data=b"{}", headers={"Content-Type": "application/json", "User-Agent": "arbitrage-observatory-probe/1.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            WORK.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.read())
    return sorted(json.loads(path.read_text())["data"].keys())


async def mode_watch() -> None:
    pairs = listed_pairs()
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=15) as ws:
        out(mode="watch", first_frame=trim(await ws.recv()), pairs=len(pairs))
        for p in pairs:
            await ws.send(json.dumps({"funcName": "orderBook", "pairName": p, "delYn": "N"}))
            await ws.send(json.dumps({"funcName": "publicSign", "pairName": p, "delYn": "N"}))
        counts = await drain(ws, 180)
        out(mode="watch", seconds=180, subscriptions=2 * len(pairs), counts=counts)


async def mode_chart() -> None:
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=15) as ws:
        await ws.recv()
        await ws.send(json.dumps({"funcName": "chartCandle", "pairName": "BTC/USDT", "type": "d"}))
        counts = await drain(ws, 15, log_all=False)
        out(mode="chart", counts=counts)


async def mode_errors() -> None:
    frames = [
        json.dumps({"funcName": "noSuchFunc", "pairName": "BTC/USDT", "delYn": "N"}),
        json.dumps({"funcName": "orderBook", "pairName": "FOO/USDT", "delYn": "N"}),
        "{not json",
        "hello",
        json.dumps({"funcName": "orderBook", "pairName": "BTC/USDT", "delYn": "Y"}),
        json.dumps({"funcName": "DeleteAllRDS"}),
    ]
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=15) as ws:
        await ws.recv()
        for f in frames:
            try:
                await ws.send(f)
            except websockets.ConnectionClosed as e:
                out(mode="errors", sent=f, closed=repr(e))
                return
            counts = await drain(ws, 4, ping_every=None)
            out(mode="errors", sent=f, counts=counts, open=ws.state.name)
        await ws.send(json.dumps({"funcName": "PING"}))
        out(mode="errors", after_all_ping_reply=trim(await asyncio.wait_for(ws.recv(), timeout=10)))


async def mode_idle() -> None:
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=15, ping_interval=None) as ws:
        await ws.recv()
        await ws.send(json.dumps({"funcName": "orderBook", "pairName": "BTC/USDT", "delYn": "N"}))
        counts = await drain(ws, 120, ping_every=None)
        out(mode="idle", seconds=120, counts=counts, open_at_end=ws.state.name)


MODES = {"connect": mode_connect, "watch": mode_watch, "chart": mode_chart, "errors": mode_errors, "idle": mode_idle}

if __name__ == "__main__":
    for m in sys.argv[1:] or list(MODES):
        asyncio.run(MODES[m]())
