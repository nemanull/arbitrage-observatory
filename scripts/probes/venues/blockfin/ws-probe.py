# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=14"]
# ///
"""Read-only WebSocket probe for BlockFin's public socket.

Public, unauthenticated, read-only.
The URL and frames are BloFin's, because a third party says BlockFin shares BloFin's API structure, and the REST host answers in BloFin's shape.
Sockets open without permessage-deflate, like the engine's book feeds.

The handshake is tried up to ATTEMPTS times, one try every 3 s, because the restricted region rule refuses some requests and not others from this exit.
On the first open socket it subscribes books and books5 on two perpetuals, the funding-rate channel and an unknown symbol, for HOLD seconds,
sends the text ping BloFin documents, and checks the books sequence rule: each update's prevSeqId equals the previous seqId.
Every other socket attempt prints its refusal status.

Run from the repository root:
    uv run scripts/probes/venues/blockfin/ws-probe.py

Raw frames go to .claude/survey-work/blockfin/ws-frames.jsonl.
Recorded in docs/profiles/blockfin/websocket.md.
"""

import asyncio
import collections
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import websockets
from websockets.exceptions import InvalidStatus

URLS = ["wss://openapi.blockfin.com/ws/public", "wss://blockfin.com/ws/public"]
ATTEMPTS = 6
HOLD = 25
WORK = Path(".claude/survey-work/blockfin")
SUBS = [
    {"channel": "books", "instId": "BTC-USDT"},
    {"channel": "books", "instId": "ETH-USDT"},
    {"channel": "books5", "instId": "BTC-USDT"},
    {"channel": "funding-rate", "instId": "BTC-USDT"},
    {"channel": "books", "instId": "NOPE-USDT"},
]


async def try_open(url: str):
    start = time.monotonic()
    try:
        ws = await websockets.connect(url, compression=None, open_timeout=15, ping_interval=None, max_size=None)
    except InvalidStatus as err:
        body = err.response.body or b""
        refused = b"IP address is from one of BlockFin's restricted" in body
        print(json.dumps({"url": url, "status": err.response.status_code, "bytes": len(body), "restricted_page": refused,
                          "cf_ray": err.response.headers.get("cf-ray"), "ms": round((time.monotonic() - start) * 1000)}))
        return None
    except Exception as err:  # noqa: BLE001, a probe reports every failure the same way
        print(json.dumps({"url": url, "error": repr(err)[:200]}))
        return None
    print(json.dumps({"url": url, "opened": True, "ms": round((time.monotonic() - start) * 1000),
                      "extensions": ws.response.headers.get("sec-websocket-extensions")}))
    return ws


async def session(ws) -> None:
    out = (WORK / "ws-frames.jsonl").open("w")
    await ws.send(json.dumps({"op": "subscribe", "args": SUBS}))
    last_seq: dict[str, int] = {}
    counts = collections.Counter()
    gaps = collections.Counter()
    first_kind = {}
    shown = collections.Counter()
    started = time.monotonic()
    next_ping = started + 10
    while time.monotonic() - started < HOLD:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=1)
        except asyncio.TimeoutError:
            raw = None
        except websockets.ConnectionClosed as err:
            print(json.dumps({"closed": True, "code": err.rcvd.code if err.rcvd else None, "after_s": round(time.monotonic() - started, 1)}))
            break
        now = time.monotonic()
        if now >= next_ping:
            await ws.send("ping")
            next_ping = now + 10
            print(json.dumps({"sent": "ping", "at_s": round(now - started, 1)}))
        if raw is None:
            continue
        out.write(json.dumps({"t": round(now - started, 3), "raw": raw if isinstance(raw, str) else raw.hex()}) + "\n")
        if raw == "pong":
            print(json.dumps({"got": "pong", "at_s": round(now - started, 1)}))
            continue
        msg = json.loads(raw)
        arg = msg.get("arg", {})
        key = f"{arg.get('channel')}:{arg.get('instId')}"
        if "event" in msg:
            print(json.dumps({"event_frame": msg}))
            continue
        counts[key] += 1
        action = msg.get("action")
        data = msg.get("data")
        if arg.get("channel") == "books" and isinstance(data, dict):
            seq, prev = data.get("seqId"), data.get("prevSeqId")
            first_kind.setdefault(key, action)
            if action == "update" and key in last_seq and prev != last_seq[key]:
                gaps[key] += 1
            last_seq[key] = seq
        if shown[(key, action)] < 1:
            shown[(key, action)] += 1
            trimmed = json.loads(raw)
            d = trimmed.get("data")
            if isinstance(d, dict):
                for side in ("asks", "bids"):
                    if isinstance(d.get(side), list):
                        d[f"{side}_levels"] = len(d[side])
                        d[side] = d[side][:3]
            elif isinstance(d, list):
                trimmed["data"] = d[:1]
            print(json.dumps({"first_frame": key, "action": action, "at_s": round(now - started, 2), "frame": trimmed})[:1500])
    out.close()
    print(json.dumps({"frames_per_channel": counts, "books_first_action": first_kind, "books_seq_gaps": gaps, "held_s": HOLD}))
    await ws.close()


async def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"blockfin ws probe, {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    opened = False
    for attempt in range(ATTEMPTS):
        for url in URLS:
            ws = await try_open(url)
            if ws and not opened:
                opened = True
                await session(ws)
            elif ws:
                await ws.close()
        await asyncio.sleep(3)
    print(json.dumps({"attempts_per_url": ATTEMPTS, "any_socket_opened": opened}))


if __name__ == "__main__":
    asyncio.run(main())
