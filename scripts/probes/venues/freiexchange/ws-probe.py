# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for FreiExchange, public market data only.

The venue documents no socket.
The market page of the web site opens wss://freiexchange.com/wss2/ and sends {"action":"subscribe","pair":"LTC_BTC"}.
The LTC quoted pairs trade on the sister site FreiXLite, whose market page opens wss://freixlite.com/wss2/ the same way.
This probe replays those subscriptions and records what the servers send.

Modes, all by default, or name some on the command line:
    connect  the handshake with and without a browser Origin header, status and response headers
    listen   subscribe the five most active BTC pairs on freiexchange.com and the four most active LTC pairs
             on freixlite.com, and record every frame for 240 s on both sockets at once,
             with client pings off, so the run also shows whether a server closes a silent client
    errors   an unknown pair, a malformed frame, an unknown action, an unsubscribe, and a client ping round trip

Every frame is printed as one JSON line with its receive time.
The socket time of a full run is about 5 minutes on two sockets at once.

Run from the repository root:
    uv run scripts/probes/venues/freiexchange/ws-probe.py [mode ...]
"""

import asyncio
import json
import sys
import time
from collections import Counter

import websockets

URL = "wss://freiexchange.com/wss2/"
ORIGIN = "https://freiexchange.com"
LITE_URL = "wss://freixlite.com/wss2/"
LITE_ORIGIN = "https://freixlite.com"
LISTEN_S = 240
PAIRS = ["LTC_BTC", "DOGE_BTC", "VTC_BTC", "AUR_BTC", "FRC_BTC"]
LITE_PAIRS = ["MAZA_LTC", "NS_LTC", "VECO_LTC", "CRD_LTC"]


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def now() -> str:
    return time.strftime("%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


async def open_ws(origin: str | None, url: str = URL):
    kw = {"ping_interval": None, "open_timeout": 15, "max_size": 2**22}
    if origin:
        kw["origin"] = origin
    return await websockets.connect(url, **kw)


async def connect_mode() -> None:
    for origin in (None, ORIGIN):
        t0 = time.perf_counter()
        try:
            ws = await open_ws(origin)
            ms = round((time.perf_counter() - t0) * 1000)
            resp = ws.response
            out(mode="connect", origin=origin, upgraded=True, status=resp.status_code, handshake_ms=ms,
                headers={k: v for k, v in resp.headers.raw_items() if k.lower() in (
                    "server", "sec-websocket-extensions", "cf-ray", "upgrade", "connection")})
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                out(mode="connect", origin=origin, first_unsolicited_frame=str(msg)[:300])
            except asyncio.TimeoutError:
                out(mode="connect", origin=origin, first_unsolicited_frame=None, note="nothing within 5 s of open")
            await ws.close()
        except websockets.exceptions.InvalidStatus as e:
            r = e.response
            out(mode="connect", origin=origin, upgraded=False, status=r.status_code, body=(r.body or b"")[:300].decode(errors="replace"))
        except Exception as e:  # noqa: BLE001
            out(mode="connect", origin=origin, upgraded=False, error=repr(e)[:300])


async def listen_mode() -> None:
    await asyncio.gather(listen_one(URL, ORIGIN, PAIRS), listen_one(LITE_URL, LITE_ORIGIN, LITE_PAIRS))


async def listen_one(url: str, origin: str, pairs: list[str]) -> None:
    ws = await open_ws(origin, url)
    for p in pairs:
        await ws.send(json.dumps({"action": "subscribe", "pair": p}))
    out(mode="listen", url=url, at=now(), sent=[{"action": "subscribe", "pair": p} for p in pairs], listen_s=LISTEN_S)
    cats: Counter = Counter()
    keys: dict = {}
    t_end = time.monotonic() + LISTEN_S
    t_last = time.monotonic()
    max_gap = 0.0
    closed = None
    while True:
        left = t_end - time.monotonic()
        if left <= 0:
            break
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        except websockets.exceptions.ConnectionClosed as e:
            closed = {"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None, "at": now()}
            break
        t = time.monotonic()
        max_gap = max(max_gap, t - t_last)
        t_last = t
        try:
            d = json.loads(msg)
        except ValueError:
            d = {"_raw": str(msg)[:300]}
        cat = f"{d.get('category')}:{d.get('pair')}" if isinstance(d, dict) else "non-object"
        cats[cat] += 1
        if isinstance(d, dict):
            keys.setdefault(d.get("category"), sorted(d.keys()))
        out(mode="listen", url=url, at=now(), bytes=len(msg), frame=str(msg)[:400])
    if closed is None:
        max_gap = max(max_gap, time.monotonic() - t_last)
        await ws.close()
    out(mode="listen", url=url, summary=True, frames=sum(cats.values()), by_category_pair=dict(cats), keys_by_category=keys,
        longest_silence_s=round(max_gap, 1), server_closed=closed,
        socket_open_at_end=closed is None)


async def errors_mode() -> None:
    ws = await open_ws(ORIGIN)
    tests = [
        ("unknown pair", json.dumps({"action": "subscribe", "pair": "NOPE_BTC"})),
        ("malformed frame", "hello"),
        ("unknown action", json.dumps({"action": "orderbook", "pair": "LTC_BTC"})),
        ("unsubscribe", json.dumps({"action": "unsubscribe", "pair": "LTC_BTC"})),
        ("app-level ping", json.dumps({"action": "ping"})),
    ]
    for name, frame in tests:
        await ws.send(frame)
        replies = []
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=4)
                replies.append(str(msg)[:300])
        except asyncio.TimeoutError:
            pass
        except websockets.exceptions.ConnectionClosed as e:
            out(mode="errors", test=name, sent=frame, closed={"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None})
            return
        out(mode="errors", test=name, sent=frame, replies=replies)
    t0 = time.perf_counter()
    try:
        pong = await ws.ping()
        await asyncio.wait_for(pong, timeout=5)
        out(mode="errors", test="protocol ping", pong=True, rtt_ms=round((time.perf_counter() - t0) * 1000))
    except Exception as e:  # noqa: BLE001
        out(mode="errors", test="protocol ping", pong=False, error=repr(e)[:200])
    await ws.close()


async def main() -> None:
    modes = sys.argv[1:] or ["connect", "listen", "errors"]
    out(probe="freiexchange ws", started=now(), url=URL, modes=modes)
    for m in modes:
        await {"connect": connect_mode, "listen": listen_mode, "errors": errors_mode}[m]()


if __name__ == "__main__":
    asyncio.run(main())
