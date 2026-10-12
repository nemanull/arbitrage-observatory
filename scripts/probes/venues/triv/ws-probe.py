# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""TRIV perpetual WebSocket probe, read-only and unauthenticated.

TRIV's futures page connects a Centrifuge client to gon.ws_endpoint, wss://ws-exchange.cfx.co.id, the socket of the CFX crypto bourse.
Channel names come from the page's scripts: orderbook.<symbol>, ticker.<symbol>, trade.<symbol> and tickers.
The page first calls the RPC private/auth with a signed payload from TRIV's backend.
This probe never sends that RPC, so it shows what an anonymous client gets.

Run from the repository root: uv run scripts/probes/venues/triv/ws-probe.py
Socket time is about 2 minutes in total over three connections.
"""

import asyncio
import json
import time

import websockets

WS = "wss://ws-exchange.cfx.co.id"
ORIGIN = "https://triv.co.id"
CHANNELS = ["orderbook.BTCUSDT-PERP", "ticker.BTCUSDT-PERP", "trade.BTCUSDT-PERP", "tickers", "orderbook.NOPEUSDT-PERP"]


def connect(origin=ORIGIN):
    kwargs = {"compression": None, "ping_interval": None, "open_timeout": 20, "user_agent_header": "Mozilla/5.0 survey-probe"}
    if origin:
        kwargs["origin"] = origin
    return websockets.connect(WS, **kwargs)


async def read_for(ws, seconds, t0, answer_pings):
    """Print every frame for the given time, answering the server's empty ping frame with an empty pong when asked."""
    end = time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return
        except websockets.ConnectionClosed as e:
            print(f"  {time.monotonic() - t0:6.2f} s closed: received {e.rcvd.code if e.rcvd else None} {e.rcvd.reason if e.rcvd else ''!r}")
            return "closed"
        for line in raw.splitlines() if isinstance(raw, str) else [raw]:
            print(f"  {time.monotonic() - t0:6.2f} s {line[:600]}")
            if answer_pings and line == "{}":
                await ws.send("{}")
                print(f"  {time.monotonic() - t0:6.2f} s sent pong {{}}")


async def subscribe_mode():
    print("\n## Subscribe without auth, right after connect and again after 3 s")
    async with connect() as ws:
        t0 = time.monotonic()
        await ws.send(json.dumps({"id": 1, "connect": {"name": "js"}}))
        await read_for(ws, 2, t0, True)
        for i, ch in enumerate(CHANNELS, start=2):
            await ws.send(json.dumps({"id": i, "subscribe": {"channel": ch}}))
        await read_for(ws, 3, t0, True)
        for i, ch in enumerate(CHANNELS[:2], start=20):
            await ws.send(json.dumps({"id": i, "subscribe": {"channel": ch}}))
        await ws.send(json.dumps({"id": 30, "rpc": {"method": "public/time", "data": {}}}))
        await read_for(ws, 3, t0, True)


async def origin_mode():
    print("\n## Connect without an Origin header")
    async with connect(origin=None) as ws:
        t0 = time.monotonic()
        await ws.send(json.dumps({"id": 1, "connect": {}}))
        await ws.send(json.dumps({"id": 2, "subscribe": {"channel": "orderbook.BTCUSDT-PERP"}}))
        await read_for(ws, 3, t0, True)


async def keepalive_mode():
    print("\n## Keepalive: answer pings for 55 s, then stop answering")
    async with connect() as ws:
        t0 = time.monotonic()
        await ws.send(json.dumps({"id": 1, "connect": {}}))
        if await read_for(ws, 55, t0, True) == "closed":
            return
        await read_for(ws, 60, t0, False)


async def main():
    print(f"TRIV ws probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC, {WS}")
    await subscribe_mode()
    await origin_mode()
    await keepalive_mode()


if __name__ == "__main__":
    asyncio.run(main())
