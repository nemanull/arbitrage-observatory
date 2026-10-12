# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only socket probe for Bitcoiva, the Socket.IO servers its web app opens and the Binance stream its trade page reads.

Modes, all by default, or name some on the command line:
    sio      a raw Engine.IO v4 handshake on each of the four Socket.IO hosts in the web bundle,
             the room join the trade page sends for BTC_USDT and BTC_INR, then every event for 45 s per host
    binance  the stream the trade page opens for its book, wss://stream.binance.com/stream with btcusdt@depth20,
             for 20 s, with each frame's top of book set beside Bitcoiva's REST depth for BTC_USDT
    errors   an unknown room, an unknown Engine.IO version, and the socket path on the API host without a namespace connect

Sockets are held for about four minutes in total by "all".
Captures go to .claude/survey-work/bitcoiva/.

Run from the repository root:
    uv run scripts/probes/venues/bitcoiva/ws-probe.py [mode ...]
"""

import asyncio
import collections
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

HOSTS = {
    "pairinfo": "rtrxastzeqsaoqd.bitcoiva.com",  # REACT_APP_SKTFRMM, bitcoiva_allPairInfo
    "exchange": "pigqueoialzban.bitcoiva.com",  # exchangeBackendURL
    "liqexchange": "oseynrzisxcadaqs.bitcoiva.com",  # exchangeLiqBackendURL
    "apistack": "apistack.bitcoiva.com",  # apiBackendUrl, also the Open API host
}
ROOMS = ["bitcoiva_BTC_USDT", "bitcoiva_BTC_INR"]
BINANCE = "wss://stream.binance.com/stream"
REST_DEPTH = "https://apistack.bitcoiva.com/api/v1/depth?symbol=BTC_USDT&limit=5"
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe", "Origin": "https://www.bitcoiva.com"}
WORK = Path(".claude/survey-work/bitcoiva")


def out(**kw) -> None:
    kw = {"t": datetime.now(timezone.utc).strftime("%H:%M:%S.%f")[:-3], **kw}
    print(json.dumps(kw, ensure_ascii=False))


def trim(s: str, n: int = 400) -> str:
    return s if len(s) <= n else s[:n] + f"...(+{len(s) - n})"


async def sio_session(name: str, host: str, rooms: list[str], hold_s: float, eio: str = "4", connect_ns: bool = True) -> dict:
    url = f"wss://{host}/socket.io/?EIO={eio}&transport=websocket"
    stats = {"host": name, "url": url, "frames": 0, "events": collections.Counter(), "pings": 0, "bytes": 0}
    samples: dict[str, str] = {}
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, additional_headers=HEADERS, open_timeout=15, max_size=2**24) as ws:
            out(host=name, step="open", handshake_ms=round((time.perf_counter() - t0) * 1000))
            end = time.monotonic() + hold_s
            joined = False
            while time.monotonic() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                stats["frames"] += 1
                stats["bytes"] += len(raw)
                text = raw if isinstance(raw, str) else raw.decode(errors="replace")
                if text.startswith("0"):
                    out(host=name, step="engine.io open", frame=trim(text))
                    if connect_ns:
                        await ws.send("40")
                elif text == "2":
                    stats["pings"] += 1
                    await ws.send("3")
                    if stats["pings"] == 1:
                        out(host=name, step="first ping answered", after_s=round(time.perf_counter() - t0, 1))
                elif text.startswith("40"):
                    out(host=name, step="namespace connect ack", frame=trim(text))
                    if not joined:
                        for room in rooms:
                            await ws.send("42" + json.dumps(["bitcoiva_room", room], separators=(",", ":")))
                        out(host=name, step="sent", frames=[f'42["bitcoiva_room","{r}"]' for r in rooms])
                        joined = True
                elif text.startswith("42"):
                    try:
                        ev = json.loads(text[2:])
                        evname = ev[0] if isinstance(ev, list) and ev else "?"
                    except ValueError:
                        evname = "unparsed"
                    stats["events"][evname] += 1
                    if evname not in samples:
                        samples[evname] = text
                        out(host=name, step="first event", event=evname, size=len(text), frame=trim(text, 700))
                else:
                    out(host=name, step="other frame", frame=trim(text))
            stats["held_s"] = round(time.perf_counter() - t0, 1)
    except Exception as e:  # noqa: BLE001, the failure itself is the finding
        stats["error"] = f"{type(e).__name__}: {e}"
        status = getattr(getattr(e, "response", None), "status_code", None)
        if status:
            stats["status"] = status
            body = getattr(getattr(e, "response", None), "body", b"") or b""
            stats["body"] = trim(body.decode(errors="replace"), 300)
    stats["events"] = dict(stats["events"])
    out(host=name, step="summary", **{k: v for k, v in stats.items() if k != "host"})
    if samples:
        (WORK / f"ws-sio-{name}.json").write_text(json.dumps(samples, indent=1))
    return stats


def rest_top() -> tuple[list, list, int | None]:
    req = urllib.request.Request(REST_DEPTH, headers={"User-Agent": HEADERS["User-Agent"]})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.loads(r.read())
    return d["bids"][0], d["asks"][0], d.get("lastUpdateId")


async def binance_mode(hold_s: float = 20.0) -> None:
    sub = {"method": "SUBSCRIBE", "params": ["btcusdt@depth20"], "id": 1}  # the trade page also adds @ticker and @aggTrade
    t0 = time.perf_counter()
    frames = 0
    matches = 0
    compared = 0
    try:
        async with websockets.connect(BINANCE, open_timeout=15, max_size=2**22) as ws:
            out(mode="binance", step="open", url=BINANCE, handshake_ms=round((time.perf_counter() - t0) * 1000))
            await ws.send(json.dumps(sub))
            end = time.monotonic() + hold_s
            next_cmp = time.monotonic() + 2
            while time.monotonic() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if "result" in msg:
                    out(mode="binance", step="ack", frame=msg)
                    continue
                frames += 1
                data = msg.get("data", {})
                if frames == 1:
                    out(mode="binance", step="first frame", stream=msg.get("stream"), lastUpdateId=data.get("lastUpdateId"),
                        levels=[len(data.get("bids", [])), len(data.get("asks", []))], bid=data["bids"][0], ask=data["asks"][0])
                if time.monotonic() >= next_cmp:
                    next_cmp = time.monotonic() + 4
                    rb, ra, rid = await asyncio.to_thread(rest_top)
                    compared += 1
                    same = rb[0] == data["bids"][0][0] and ra[0] == data["asks"][0][0]
                    matches += same
                    out(mode="binance", step="compare", binance_id=data.get("lastUpdateId"), bitcoiva_id=rid,
                        id_gap=(rid - data["lastUpdateId"]) if rid else None,
                        binance_top=[data["bids"][0][0], data["asks"][0][0]], bitcoiva_top=[rb[0], ra[0]], same_prices=same)
    except Exception as e:  # noqa: BLE001
        out(mode="binance", step="error", error=f"{type(e).__name__}: {e}")
    out(mode="binance", step="summary", frames=frames, per_s=round(frames / hold_s, 2), compared=compared, same_top=matches)


async def main(modes: list[str]) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    if "sio" in modes:
        for name, host in HOSTS.items():
            await sio_session(name, host, ROOMS, 45)
    if "binance" in modes:
        await binance_mode()
    if "errors" in modes:
        await sio_session("pairinfo-unknown-room", HOSTS["pairinfo"], ["bitcoiva_NOPE_USDT"], 10)
        await sio_session("pairinfo-eio3", HOSTS["pairinfo"], [], 5, eio="3")
        await sio_session("apistack-no-namespace", HOSTS["apistack"], [], 5, connect_ns=False)


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1:] or ["sio", "binance", "errors"]))
