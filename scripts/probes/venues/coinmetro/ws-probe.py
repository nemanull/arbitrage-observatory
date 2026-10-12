# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for Coinmetro, public book updates and ticks.

The socket takes its subscription in the query string, `?pairs=BTCEUR,ETHEUR`, and needs no token for market data.
Four sessions run one after another, holding sockets for about 2.5 minutes in total:
    live      wss://api.coinmetro.com/ws?pairs=BTCEUR,ETHEUR for 60 s
    unknown   the same URL with pairs=NOPEEUR for 15 s
    nopairs   the same URL with no query for 15 s
    demo      wss://api.coinmetro.com/open/ws?pairs=BTCEUR,ETHEUR for 45 s, the demo environment, for frame shapes

Compression is refused, as the engine's feeds do, so the probe sees what a feed would see.

Run from the repository root:
    uv run scripts/probes/venues/coinmetro/ws-probe.py [session ...]
"""

import asyncio
import collections
import json
import sys
import time

import websockets

SESSIONS = {
    "live": ("wss://api.coinmetro.com/ws?pairs=BTCEUR,ETHEUR", 60),
    "unknown": ("wss://api.coinmetro.com/ws?pairs=NOPEEUR", 15),
    "nopairs": ("wss://api.coinmetro.com/ws", 15),
    "demo": ("wss://api.coinmetro.com/open/ws?pairs=BTCEUR,ETHEUR", 45),
}


def kind(msg) -> str:
    if isinstance(msg, bytes):
        return "binary"
    try:
        d = json.loads(msg)
    except ValueError:
        return "text:" + msg[:20]
    return ",".join(sorted(d.keys())) if isinstance(d, dict) else type(d).__name__


async def session(name: str, url: str, seconds: int) -> None:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=15, close_timeout=3, compression=None, ping_interval=None) as ws:
            ext = ws.response.headers.get("Sec-WebSocket-Extensions")
            print(json.dumps({"session": name, "url": url, "result": "open", "handshake_ms": round((time.perf_counter() - t0) * 1000),
                              "status": ws.response.status_code, "extensions": ext}))
            p0 = time.perf_counter()
            try:
                await asyncio.wait_for(await ws.ping(), timeout=10)
                pong = {"protocol_pong_ms": round((time.perf_counter() - p0) * 1000)}
            except asyncio.TimeoutError:
                pong = {"protocol_pong_ms": None}
            print(json.dumps({"session": name, **pong}))
            kinds, samples, first_at, pairs = collections.Counter(), {}, {}, collections.Counter()
            seqs = collections.defaultdict(list)
            end = time.monotonic() + seconds
            while True:
                left = end - time.monotonic()
                if left <= 0:
                    break
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                k = kind(msg)
                kinds[k] += 1
                first_at.setdefault(k, round(seconds - left, 2))
                samples.setdefault(k, msg[:600] if isinstance(msg, str) else repr(msg[:60]))
                if isinstance(msg, str) and k in ("bookUpdate", "tick"):
                    body = json.loads(msg)[k]
                    pairs[(k, body.get("pair"))] += 1
                    if k == "bookUpdate":
                        seqs[body["pair"]].append(body.get("seqNumber"))
            print(json.dumps({"session": name, "seconds": seconds, "frames_by_kind": kinds, "first_frame_at_s": first_at,
                              "by_pair": {f"{a}:{b}": n for (a, b), n in pairs.items()},
                              "book_seq_steps": {p: collections.Counter(b - a for a, b in zip(s, s[1:])).most_common(3) for p, s in seqs.items()},
                              "still_open": ws.close_code is None}, default=str))
            for k, s in samples.items():
                print(json.dumps({"session": name, "sample_kind": k, "frame": s}))
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        print(json.dumps({"session": name, "url": url, "result": "handshake refused", "status": r.status_code,
                          "body": r.body[:200].decode("utf-8", "replace") if r.body else None}))
    except websockets.exceptions.ConnectionClosed as e:
        print(json.dumps({"session": name, "url": url, "result": "closed", "code": e.rcvd.code if e.rcvd else None,
                          "reason": e.rcvd.reason if e.rcvd else None, "after_s": round(time.perf_counter() - t0, 1)}))
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"session": name, "url": url, "result": type(e).__name__, "error": str(e)[:200]}))


async def main() -> None:
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for name in sys.argv[1:] or list(SESSIONS):
        url, seconds = SESSIONS[name]
        await session(name, url, seconds)


if __name__ == "__main__":
    asyncio.run(main())
