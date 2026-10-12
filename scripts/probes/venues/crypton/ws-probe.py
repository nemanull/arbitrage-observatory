# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Crypton Exchange public socket probe for docs/profiles/crypton/websocket.md.

Read-only and unauthenticated.
The venue's web client talks Socket.IO to https://crp.is:8181 with the websocket transport only.
This probe speaks the Engine.IO 3 framing by hand over a plain WebSocket, so it needs no Socket.IO library.
It holds two sockets side by side for about two and a half minutes, then two short ones, about three minutes of wall time in total.
Run from the repository root with: uv run scripts/probes/venues/crypton/ws-probe.py
"""

import asyncio
import collections
import json
import time
import urllib.request

import websockets

URL3 = "wss://crp.is:8181/socket.io/?EIO=3&transport=websocket"
URL4 = "wss://crp.is:8181/socket.io/?EIO=4&transport=websocket"
MAIN_SECONDS = 150
SILENT_SECONDS = 45


def stamp() -> str:
    return time.strftime("%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}"


def decode(frame: str):
    """Split an Engine.IO 3 text frame into its packet type and the Socket.IO event, if any."""
    if frame.startswith("42"):
        body = json.loads(frame[2:])
        return "event", body[0], body[1] if len(body) > 1 else None
    return {"0": "open", "2": "ping", "3": "pong", "40": "connect", "41": "disconnect", "44": "error"}.get(frame, "other"), None, None


async def main_session():
    print(f"\n### main session {URL3}")
    t0 = time.perf_counter()
    async with websockets.connect(URL3, open_timeout=20, ping_interval=None, max_size=2**22) as ws:
        print(f"{stamp()} handshake {1000 * (time.perf_counter() - t0):.0f} ms")
        opening = [await asyncio.wait_for(ws.recv(), 10) for _ in range(2)]
        for f in opening:
            print(f"{stamp()} recv {f[:300]}")
        sid_info = json.loads(opening[0][1:])
        ping_every = sid_info["pingInterval"] / 1000

        await ws.send('42["trade-join","crp_usdt"]')
        print(f"{stamp()} sent trade-join crp_usdt")

        counts = collections.Counter()
        book_frames, first_seen, last_ping, pong_rtt = [], {}, time.monotonic(), []
        ping_sent_at = None
        joined_extra = joined_bad = joined_left = False
        start = time.monotonic()
        while time.monotonic() - start < MAIN_SECONDS:
            now = time.monotonic()
            if now - last_ping >= ping_every:
                await ws.send("2")
                ping_sent_at, last_ping = now, now
            elapsed = now - start
            if elapsed > 40 and not joined_bad:
                await ws.send('42["trade-join","nope_usdt"]')
                print(f"{stamp()} sent trade-join nope_usdt")
                joined_bad = True
            if elapsed > 50 and not joined_extra:
                await ws.send('42["trade-join","uusd_usdt"]')
                print(f"{stamp()} sent trade-join uusd_usdt on the same socket")
                joined_extra = True
            if elapsed > 100 and not joined_left:
                await ws.send('42["trade-leave","crp_usdt"]')
                print(f"{stamp()} sent trade-leave crp_usdt")
                joined_left = True
            try:
                frame = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            kind, event, payload = decode(frame)
            key = event or kind
            counts[key] += 1
            if kind == "pong" and ping_sent_at is not None:
                pong_rtt.append(1000 * (time.monotonic() - ping_sent_at))
            if key not in first_seen:
                first_seen[key] = frame
                print(f"{stamp()} first {key}: {frame[:600]}")
            if event == "book":
                phase = "after leave" if joined_left else "after uusd join" if joined_extra else "crp only"
                payload = dict(payload, _phase=phase)
                book_frames.append((round(time.monotonic() - start, 1), payload))
            elif event in ("trade_history", "pairs"):
                print(f"{stamp()} {event} for pair {payload.get('pair')}, keys {list(payload)}")
        print(f"\nframe counts over {MAIN_SECONDS} s: {dict(counts)}")
        print(f"pong round trips ms: {[round(x) for x in pong_rtt]}")
        print(f"book frames: {len(book_frames)}")
        for t, p in book_frames[:25]:
            print(f"   t+{t}s {json.dumps(p)[:300]}")
        shapes = collections.Counter((p.get("type"), len(p.get("book") or [])) for _, p in book_frames if isinstance(p, dict))
        print(f"book (type, levels in book) counts: {dict(shapes)}")
        keys = collections.Counter(tuple(sorted(k for k in p if k != "_phase")) for _, p in book_frames if isinstance(p, dict))
        print(f"book payload key sets: {dict(keys)}")
        per_pair = collections.Counter((p["_phase"], f"{p.get('cur')}_{p.get('ecur')}") for _, p in book_frames)
        print(f"book frames by (phase, cur_ecur): {dict(per_pair)}")
        times = [p["time"] for _, p in book_frames]
        print(f"book time field non-decreasing: {times == sorted(times)}, min gap ms {min(b - a for a, b in zip(times, times[1:])) if len(times) > 1 else None}")
        arrivals = [t for t, _ in book_frames]
        gaps = sorted(b - a for a, b in zip(arrivals, arrivals[1:]))
        if gaps:
            print(f"book arrival gaps s: median {gaps[len(gaps) // 2]:.1f}, max {gaps[-1]:.1f}, first frame at t+{arrivals[0]}s, last at t+{arrivals[-1]}s")
        return counts


async def passive_session():
    """Runs beside the main session, never joins a room, and sends no ping for the first SILENT_SECONDS."""
    print(f"\n### passive session: no trade-join, no ping for {SILENT_SECONDS} s against pingTimeout 60 s")
    counts = collections.Counter()
    async with websockets.connect(URL3, open_timeout=20, ping_interval=None) as ws:
        start = time.monotonic()
        last_ping = start
        try:
            while time.monotonic() - start < MAIN_SECONDS:
                now = time.monotonic()
                if now - start > SILENT_SECONDS and now - last_ping >= 25:
                    await ws.send("2")
                    last_ping = now
                try:
                    frame = await asyncio.wait_for(ws.recv(), 1)
                except asyncio.TimeoutError:
                    continue
                kind, event, payload = decode(frame)
                key = event or kind
                if event == "book":
                    key = f"book {payload.get('cur')}_{payload.get('ecur')}"
                elif event in ("pairs", "trade_history"):
                    key = f"{event} {payload.get('pair')}"
                counts[key] += 1
            print(f"{stamp()} passive session open for {MAIN_SECONDS} s, frame counts {dict(counts)}")
        except websockets.ConnectionClosed as e:
            print(f"{stamp()} passive closed after {time.monotonic() - start:.0f} s: {e}, counts {dict(counts)}")


async def eio4_session():
    print(f"\n### EIO=4 handshake {URL4}")
    try:
        async with websockets.connect(URL4, open_timeout=20, ping_interval=None) as ws:
            for _ in range(2):
                print(f"{stamp()} recv {(await asyncio.wait_for(ws.recv(), 10))[:200]}")
    except Exception as e:  # noqa: BLE001 - the refusal itself is the finding
        print(f"{stamp()} EIO=4 failed: {type(e).__name__} {e}")


def polling_handshake():
    print("\n### polling transport handshake")
    req = urllib.request.Request("https://crp.is:8181/socket.io/?EIO=3&transport=polling", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        print(f"{stamp()} HTTP {resp.status} {resp.read().decode('utf-8', 'replace')[:200]}")


async def plain_ws_session():
    print("\n### plain WebSocket on the REST port, wss://crp.is:8182/")
    try:
        async with websockets.connect("wss://crp.is:8182/", open_timeout=20) as ws:
            print(f"{stamp()} opened, first frame {(await asyncio.wait_for(ws.recv(), 5))[:200]}")
    except Exception as e:  # noqa: BLE001
        print(f"{stamp()} failed: {type(e).__name__} {e}")


async def main():
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    await asyncio.gather(main_session(), passive_session())
    await eio4_session()
    await plain_ws_session()
    polling_handshake()
    print("probe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
