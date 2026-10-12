# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Tebbit WebSocket endpoint probe for docs/profiles/tebbit/websocket.md section 1.

Public, unauthenticated and read-only, about 12 socket seconds in total.
It checks the three URL shapes the website bundle builds, and whether the market socket speaks XT's documented Open API protocol:
  1. wss://tebbit.io/ws, which the bundle never uses alone.
  2. wss://tebbit.io/ws/market with XT's {"method": "SUBSCRIBE", ...} frame, then a text ping.
  3. wss://tebbit.io/ws/socket, the spot URL, with the futures style sub_symbol frame.
Run from the repository root with: uv run scripts/probes/venues/tebbit/endpoints-probe.py
"""

import asyncio
import json
import time

import websockets


async def listen(ws, secs):
    got = []
    end = time.time() + secs
    while time.time() < end:
        try:
            got.append(await asyncio.wait_for(ws.recv(), end - time.time()))
        except (asyncio.TimeoutError, websockets.ConnectionClosed):
            break
    return got


async def check(url, frames, secs):
    try:
        async with websockets.connect(url, compression=None, open_timeout=10, ping_interval=None) as ws:
            ext = ws.response.headers.get("sec-websocket-extensions")
            for f in frames:
                await ws.send(f if isinstance(f, str) else json.dumps(f))
            got = await listen(ws, secs)
            print(f"  {url}: opened, extensions {ext}, sent {len(frames)} frames, got {len(got)} in {secs} s: {[g[:80] for g in got[:5]]}")
    except Exception as e:  # noqa: BLE001 - the refusal is the finding
        print(f"  {url}: {type(e).__name__}: {e}")


async def main():
    print(f"tebbit endpoints probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    await check("wss://tebbit.io/ws", [], 1)
    xt_frame = {"method": "SUBSCRIBE", "params": ["depth_update@btc_usdt,100ms", "depth@btc_usdt,50,100ms", "mark_price@btc_usdt"], "id": "a1"}
    await check("wss://tebbit.io/ws/market", [xt_frame], 5)
    await check("wss://tebbit.io/ws/market", [xt_frame, "ping"], 2)
    await check("wss://tebbit.io/ws/socket", [{"req": "sub_symbol", "symbol": "btc_usdt"}], 4)


if __name__ == "__main__":
    asyncio.run(main())
