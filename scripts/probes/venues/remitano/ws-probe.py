# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Remitano public WebSocket probe, read-only and unauthenticated.

Remitano publishes no WebSocket documentation.
The two socket hosts come from the web app HTML served at https://remitano.com/policy/api_terms_of_service, which sets
window.WEBSOCKET_HOST = "socket.remitano.com" (a Socket.IO server) and window.CABLESOCKET_HOST = "cablesocket.remitano.com/cable" (Rails ActionCable).
The room names and the subscribe frame come from the web app bundle https://cdn.remitano.com/assets/chunks/react-35b6ed4f.js,
which emits 42["subscribe",{"room":<room>,"token":<token>}] and listens for events named "socket:<room>:<event>".

Run from the repository root: uv run scripts/probes/venues/remitano/ws-probe.py [mode]
Modes and their socket time:
  session  about 180 s: subscribe the book room order_book_price_level_state plus exchange_rates and an unknown room, emit an unknown event, answer every ping
  junk     about 5 s: send one frame that is not a Socket.IO packet and report how the server answers
  silence  up to 120 s: subscribe the book room, never answer a ping, wait for the server to close
  cable    about 15 s: open the ActionCable socket and subscribe its two public channels the web app names
  all      session, silence, cable and junk in turn (the default), about five minutes of socket time
"""

import asyncio
import collections
import functools
import json
import sys
import time

import websockets

print = functools.partial(print, flush=True)

SIO = "wss://socket.remitano.com/socket.io/?EIO=4&transport=websocket"
CABLE = "wss://cablesocket.remitano.com/cable"
ORIGIN = "https://remitano.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
BOOK_ROOM = "order_book_price_level_state"


def stamp(t0):
    return f"{time.monotonic() - t0:7.1f}s"


def sio_event(frame):
    """Splits a Socket.IO EVENT packet 42[...] into its name and payload, or returns None for other packets."""
    if not frame.startswith("42"):
        return None
    arr = json.loads(frame[2:])
    return arr[0], (arr[1] if len(arr) > 1 else None)


async def sio_open(t0):
    ws = await websockets.connect(SIO, origin=ORIGIN, compression=None, user_agent_header=UA, max_size=None)
    hdr = {k.lower(): v for k, v in ws.response.headers.raw_items() if k.lower() in ("sec-websocket-extensions", "server", "cf-ray")}
    print(f"{stamp(t0)} open {ws.response.status_code} headers {hdr}")
    print(f"{stamp(t0)} < {await ws.recv()}")  # engine.io OPEN packet with pingInterval and pingTimeout
    await ws.send("40")
    print(f"{stamp(t0)} > 40")
    print(f"{stamp(t0)} < {await ws.recv()}")  # Socket.IO CONNECT ack for the default namespace
    return ws


async def subscribe(ws, t0, room):
    frame = "42" + json.dumps(["subscribe", {"room": room, "token": ""}])
    await ws.send(frame)
    print(f"{stamp(t0)} > {frame}")


async def session(seconds=180):
    print(f"== session, {seconds} s")
    t0 = time.monotonic()
    ws = await sio_open(t0)
    await subscribe(ws, t0, BOOK_ROOM)
    await subscribe(ws, t0, "exchange_rates")
    await subscribe(ws, t0, "no_such_room_xyz")
    await ws.send("42" + json.dumps(["no_such_event", {"x": 1}]))
    print(f'{stamp(t0)} > 42["no_such_event",{{"x": 1}}]')
    events = collections.Counter()
    pairs = collections.Counter()
    levels = collections.Counter()
    book_times = []
    first = {}
    pings = []
    end = time.monotonic() + seconds
    closed = None
    while time.monotonic() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            closed = (e.rcvd.code if e.rcvd else None, e.rcvd.reason if e.rcvd else None)
            break
        if m == "2":
            pings.append(round(time.monotonic() - t0, 1))
            await ws.send("3")
            continue
        ev = sio_event(m)
        if ev is None:
            print(f"{stamp(t0)} < other packet {m[:300]}")
            continue
        name, payload = ev
        events[name] += 1
        if name not in first:
            first[name] = m
            print(f"{stamp(t0)} < first {name} ({len(m)} bytes) {m[:600]}")
        if name == f"socket:{BOOK_ROOM}:update":
            book_times.append(round(time.monotonic() - t0, 1))
            pair = payload.get("order_book_pair")
            pairs[pair] += 1
            levels[len(payload.get("price_levels") or [])] += 1
            if pairs[pair] <= 2 and pair in ("btc_usdt", "usdt_btc", "eth_usdt", "usdt_eth"):
                print(f"{stamp(t0)} < {pair} update {m[:600]}")
    await ws.close()
    print(f"{stamp(t0)} closed by server {closed}" if closed else f"{stamp(t0)} closed by probe")
    print(f"events by name {dict(events)}")
    print(f"server pings at {pings}")
    print(f"book updates {len(book_times)}, first ten at {book_times[:10]}")
    print(f"book updates by pair, top 25 {pairs.most_common(25)}")
    print(f"distinct pairs updated {len(pairs)}")
    print(f"levels per update {sorted(levels.items())}")
    if book_times:
        gaps = [b - a for a, b in zip(book_times, book_times[1:])]
        print(f"longest gap between book updates {max(gaps) if gaps else None} s")


async def silence(seconds=120):
    print(f"== silence, up to {seconds} s, pings unanswered")
    t0 = time.monotonic()
    ws = await sio_open(t0)
    await subscribe(ws, t0, BOOK_ROOM)
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
        except asyncio.TimeoutError:
            print(f"{stamp(t0)} still open at the cap")
            break
        except websockets.ConnectionClosed as e:
            print(f"{stamp(t0)} closed by server, code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None!r}")
            return
        if m == "2":
            print(f"{stamp(t0)} < ping 2, not answered")
        elif not m.startswith("42"):
            print(f"{stamp(t0)} < {m[:200]}")
    await ws.close()


async def junk(seconds=5):
    print(f"== junk, {seconds} s")
    t0 = time.monotonic()
    ws = await sio_open(t0)
    await ws.send("not a socket.io packet")
    print(f"{stamp(t0)} > not a socket.io packet")
    try:
        m = await asyncio.wait_for(ws.recv(), timeout=seconds)
        print(f"{stamp(t0)} < {m[:200]}")
        await ws.close()
    except asyncio.TimeoutError:
        print(f"{stamp(t0)} no answer, still open")
        await ws.close()
    except websockets.ConnectionClosed as e:
        print(f"{stamp(t0)} closed by server, code {e.rcvd.code if e.rcvd else None}")


async def cable(seconds=15):
    print(f"== cable, {seconds} s")
    t0 = time.monotonic()
    try:
        ws = await websockets.connect(CABLE, origin=ORIGIN, compression=None, user_agent_header=UA,
                                      subprotocols=["actioncable-v1-json", "actioncable-unsupported"])
    except Exception as e:  # a refusal is a finding, so print it and carry on
        print(f"{stamp(t0)} connect failed {type(e).__name__}: {e}")
        return
    print(f"{stamp(t0)} open {ws.response.status_code} subprotocol {ws.subprotocol}")
    for ch in ("ExchangeRateChannel", "DefaultSwapRateChannel"):
        frame = json.dumps({"command": "subscribe", "identifier": json.dumps({"channel": ch})})
        await ws.send(frame)
        print(f"{stamp(t0)} > {frame}")
    kinds = collections.Counter()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            print(f"{stamp(t0)} closed by server {e.rcvd.code if e.rcvd else None}")
            return
        d = json.loads(m)
        k = d.get("type") or "message"
        kinds[k] += 1
        if kinds[k] <= 2:
            print(f"{stamp(t0)} < {m[:400]}")
    await ws.close()
    print(f"frame kinds {dict(kinds)}")


async def main(mode):
    if mode in ("session", "all"):
        await session()
    if mode in ("silence", "all"):
        await silence()
    if mode in ("cable", "all"):
        await cable()
    if mode in ("junk", "all"):
        await junk()


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1] if len(sys.argv) > 1 else "all"))
