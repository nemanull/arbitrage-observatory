# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket handshake probe for CoinP.

CoinP publishes no socket URL, so this tries the hosts its domains resolve to with a few common paths.
Each attempt is one handshake with a ten second timeout, so the whole probe holds no socket for long.

Run from the repository root:
    uv run scripts/probes/venues/coinp/ws-probe.py
"""

import asyncio
import json
import time

import websockets

URLS = [
    "wss://www.coinp.com/ws",
    "wss://www.coinp.com/websocket",
    "wss://api.coinp.com/ws",
    "wss://ws.coinp.com/",
    "wss://futures.coinp.com/ws",
    "wss://www.coinp1000.com/ws",
    "wss://www.coinp.io/ws",
]


async def attempt(url: str) -> dict:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10, close_timeout=2) as ws:
            # Never reached while the origin is down. Kept so a revived origin shows what it sends first.
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                first = None
            return {"url": url, "result": "open", "first_frame": str(first)[:200]}
    except websockets.exceptions.InvalidStatus as e:
        resp = e.response
        return {
            "url": url,
            "result": "handshake refused",
            "status": resp.status_code,
            "server": resp.headers.get("server"),
            "cf_ray": resp.headers.get("cf-ray"),
            "body": resp.body[:60].decode("utf-8", "replace") if resp.body else None,
            "ms": round((time.perf_counter() - t0) * 1000),
        }
    except Exception as e:  # noqa: BLE001
        return {"url": url, "result": type(e).__name__, "error": str(e)[:200], "ms": round((time.perf_counter() - t0) * 1000)}


async def main() -> None:
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for url in URLS:
        print(json.dumps(await attempt(url), ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
