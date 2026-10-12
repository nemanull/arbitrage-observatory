# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""ASTX (astx.io) WebSocket probe for docs/profiles/astx/websocket.md.

Public, unauthenticated and read-only.
ASTX publishes no WebSocket URL and no API documentation, and DNS answers for no API or socket subdomain, see rest-probe.py.
So this probe tries the only host there is, www.astx.io, at its root and at three common socket paths, and records how each opening handshake ends.
Four connection attempts, each given 20 s, about 80 s in total, and no socket is ever opened.
Run from the repository root with: uv run scripts/probes/venues/astx/ws-probe.py
"""

import asyncio
import time

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
URLS = ["wss://www.astx.io/", "wss://www.astx.io/ws", "wss://www.astx.io/websocket", "wss://www.astx.io/stream"]


async def attempt(url):
    t = time.monotonic()
    try:
        async with websockets.connect(url, user_agent_header=UA, origin="https://www.astx.io", open_timeout=20) as ws:
            print(f"{url}: opened in {1000 * (time.monotonic() - t):.0f} ms, subprotocol {ws.subprotocol}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {e} after {1000 * (time.monotonic() - t):.0f} ms")


async def main():
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, websockets {websockets.__version__}")
    for url in URLS:
        await attempt(url)


if __name__ == "__main__":
    asyncio.run(main())
