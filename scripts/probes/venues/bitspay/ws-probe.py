# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of the Bitspay socket at socket.bitspay.io.

The web app at www.bitspay.io connects socket.io-client 2.1.2 to this host.
The probe speaks Engine.IO 3 framing by hand, joins the BTC_USDT room the way an anonymous trade page does, and records every event name, size and gap.
It holds sockets for about two and a half minutes in total, over three sessions: joined, joined with the trade requests, and not joined.

Run with: uv run scripts/probes/venues/bitspay/ws-probe.py
"""

import asyncio
import json
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from pathlib import Path

import websockets

HOST = "socket.bitspay.io"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe"}
WORK = Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "bitspay"
LISTEN_JOINED_S = 75
LISTEN_TRADEDATA_S = 30
LISTEN_UNJOINED_S = 45


def log(*a):
    print(*a, flush=True)


def polling_handshake(eio: int):
    url = f"https://{HOST}/socket.io/?EIO={eio}&transport=polling"
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        body = r.read().decode()
        log(f"polling EIO={eio}: status {r.status}, content-type {r.headers.get('content-type')}, body {body[:160]!r}")


def plain_root():
    req = urllib.request.Request(f"https://{HOST}/", headers=UA)
    with urllib.request.urlopen(req, timeout=15) as r:
        log(f"GET / status {r.status}, body {r.read().decode()[:120]!r}")


def decode(msg: str):
    """Split an Engine.IO 3 packet into (engine type, socket.io type, event, payload)."""
    if not msg:
        return ("empty", None, None, None)
    et = msg[0]
    if et != "4":
        return (et, None, None, msg[1:])
    st = msg[1:2]
    body = msg[2:]
    if st == "2":
        try:
            arr = json.loads(body)
            return (et, st, arr[0], arr[1:] if len(arr) > 1 else None)
        except Exception:
            return (et, st, "unparsed", body)
    return (et, st, None, body)


async def session(label: str, emits: list, listen_s: float, captures: dict):
    url = f"wss://{HOST}/socket.io/?EIO=3&transport=websocket"
    t0 = time.monotonic()
    counts = Counter()
    sizes = defaultdict(list)
    gaps = defaultdict(list)
    last_seen = {}
    ids = Counter()
    async with websockets.connect(url, additional_headers=UA, open_timeout=15, max_size=2**24) as ws:
        log(f"[{label}] connected to {url} in {(time.monotonic() - t0) * 1000:.0f} ms")
        first = await asyncio.wait_for(ws.recv(), 15)
        log(f"[{label}] open packet: {first[:200]}")
        captures.setdefault("open", first)
        open_info = json.loads(first[1:])
        ping_every = open_info.get("pingInterval", 25000) / 1000
        sent = False
        next_ping = time.monotonic() + ping_every
        pings = []
        deadline = time.monotonic() + listen_s
        while time.monotonic() < deadline:
            timeout = max(0.05, min(deadline, next_ping) - time.monotonic())
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout)
            except asyncio.TimeoutError:
                if time.monotonic() >= next_ping:
                    pings.append(time.monotonic())
                    await ws.send("2")
                    next_ping = time.monotonic() + ping_every
                continue
            now = time.monotonic()
            et, st, ev, payload = decode(msg)
            if et == "3":
                rtt = (now - pings[-1]) * 1000 if pings else -1
                log(f"[{label}] pong after client ping, {rtt:.0f} ms")
                captures.setdefault("pong", msg)
                counts["engine pong"] += 1
                continue
            if et == "4" and st == "0":
                log(f"[{label}] socket.io connect packet {msg!r}")
                captures.setdefault("connect", msg)
                counts["socket.io connect"] += 1
                if not sent:
                    for e in emits:
                        frame = "42" + json.dumps(e, separators=(",", ":"))
                        await ws.send(frame)
                        log(f"[{label}] sent {frame}")
                    sent = True
                continue
            key = ev if ev else f"engine {et} socket.io {st}"
            counts[key] += 1
            sizes[key].append(len(msg))
            if key in last_seen:
                gaps[key].append(now - last_seen[key])
            last_seen[key] = now
            if ev == "refreshorders" and payload:
                ids[json.dumps(payload[0], sort_keys=True)] += 1
            if counts[key] <= 2:
                log(f"[{label}] +{now - t0:.1f}s event {key!r} {len(msg)} bytes: {msg[:400]}")
            captures.setdefault(f"{label}:{key}", msg[:4000])
        log(f"[{label}] closing after {time.monotonic() - t0:.0f} s")
    log(f"[{label}] event counts: {dict(counts)}")
    log(f"[{label}] refreshorders ids: {dict(ids)}")
    for k, v in sizes.items():
        g = gaps.get(k, [])
        gtxt = f", gap min {min(g):.2f} s median {sorted(g)[len(g) // 2]:.2f} s max {max(g):.2f} s" if g else ""
        log(f"[{label}] {k!r}: {len(v)} frames, size min {min(v)} max {max(v)}{gtxt}")
    return counts


async def eio4_attempt():
    url = f"wss://{HOST}/socket.io/?EIO=4&transport=websocket"
    async with websockets.connect(url, additional_headers=UA, open_timeout=15) as ws:
        first = await asyncio.wait_for(ws.recv(), 15)
        log(f"[eio4] open packet: {first[:200]}")
        await ws.send("40")
        try:
            nxt = await asyncio.wait_for(ws.recv(), 5)
            log(f"[eio4] reply to a version 4 connect '40': {nxt[:200]!r}")
        except asyncio.TimeoutError:
            log("[eio4] no reply to '40' within 5 s")


async def bare_ws():
    url = f"wss://{HOST}/"
    try:
        async with websockets.connect(url, additional_headers=UA, open_timeout=15) as ws:
            log(f"[bare] upgraded at {url}")
            try:
                m = await asyncio.wait_for(ws.recv(), 5)
                log(f"[bare] first frame {m[:200]!r}")
            except asyncio.TimeoutError:
                log("[bare] no frame within 5 s")
    except Exception as e:
        log(f"[bare] {url} refused: {type(e).__name__}: {e}")


async def main():
    WORK.mkdir(parents=True, exist_ok=True)
    polling_handshake(3)
    polling_handshake(4)
    plain_root()
    await bare_ws()
    await eio4_attempt()
    captures = {}
    # What an anonymous trade page sends on load: the room name only.
    await session("joined", [["setmycombinations", {"myordercombination": "BTC_USDT"}]], LISTEN_JOINED_S, captures)
    # What the page sends after a refreshorders event, with no session id or token.
    trade_req = {"market": "USDT", "vendor": "BTC", "combination": "BTC_USDT", "sessionid": None,
                 "authid": None, "accesstoken": None, "msg": "Client to server, can you hear me server?"}
    await session("tradedata", [["setmycombinations", {"myordercombination": "BTC_USDT"}],
                                ["sendTradedata", trade_req], ["senddata", trade_req]], LISTEN_TRADEDATA_S, captures)
    # No room joined: shows whether refreshorders is a broadcast or follows the room.
    await session("unjoined", [], LISTEN_UNJOINED_S, captures)
    out = WORK / "ws-captures.json"
    out.write_text(json.dumps(captures, indent=1))
    log(f"captures written to {out}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(1)
