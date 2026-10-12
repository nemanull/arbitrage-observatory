# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""BlueBit futures socket check for docs/profiles/bluebit/websocket.md.

futuresws.<domain>/kline-api/ws is the futures socket name of the other ChainUP members in server/src/venues/chainup.rs.
This opens it once, subscribes the BTC perpetual book and ticker in ChainUP's spelling, and listens for 6 s.
Public, unauthenticated and read-only, under 10 s of socket time.
Run from the repository root with: uv run scripts/probes/venues/bluebit/futures-ws-probe.py
"""

import asyncio
import gzip
import json
import socket
import time

import websockets

HOST = "futuresws.bluebit.io"
URL = f"wss://{HOST}/kline-api/ws"


async def main() -> None:
    try:
        print(f"{HOST} resolves to {sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})}")
    except socket.gaierror as err:
        print(f"{HOST} does not resolve: {err}")
        return
    t0 = time.perf_counter()
    try:
        ws = await websockets.connect(URL, compression=None, open_timeout=15, user_agent_header="Mozilla/5.0 (arbitrage-observatory-probe/1.0)")
    except websockets.InvalidStatus as err:
        body = err.response.body.decode("utf-8", "replace") if err.response.body else ""
        title = body[body.find("<title>") + 7:body.find("</title>")] if "<title>" in body else body[:200]
        print(f"handshake refused: HTTP {err.response.status_code} after {(time.perf_counter() - t0) * 1000:.0f} ms, body {title!r}")
        return
    except (OSError, asyncio.TimeoutError, websockets.InvalidHandshake) as err:
        print(f"handshake failed: {type(err).__name__} {err}")
        return
    print(f"open {(time.perf_counter() - t0) * 1000:.0f} ms, status {ws.response.status_code}")
    for ch in ("market_e_btcusdt_depth_step0", "market_e_btcusdt_ticker"):
        await ws.send(json.dumps({"event": "sub", "params": {"channel": ch, "cb_id": "probe"}}))
    frames, end = [], time.perf_counter() + 6
    while (left := end - time.perf_counter()) > 0:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as err:
            print(f"closed by server: {err.rcvd.code if err.rcvd else None}")
            break
        text = gzip.decompress(raw).decode() if isinstance(raw, bytes) and raw[:2] == b"\x1f\x8b" else (raw.decode() if isinstance(raw, bytes) else raw)
        frames.append(text)
    await ws.close()
    data = [f for f in frames if not f.startswith('{"ping"')]
    print(f"frames {len(frames)}, pings {len(frames) - len(data)}, data frames {len(data)}")
    for f in data[:3]:
        print("  ", f[:300])


if __name__ == "__main__":
    asyncio.run(main())
