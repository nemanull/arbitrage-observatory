# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Coinut at wss://wsapi.coinut.com, per https://github.com/coinut/api/wiki.

Modes, all by default, or name some on the command line:
    book     one socket for 120 s: hb, inst_list SPOT, then inst_order_book (full and top_n 10), inst_tick and inst_trade with subscribe true on every spot instrument.
             It sends an application hb every 20 s, reports the snapshot replies, every update frame with its trans_id, and frame counts per reply type.
    errors   one short socket: an unknown inst_id, top_n 20, an unknown request, text that is not JSON, a nonce out of range, and an unsubscribe.
    deflate  one short socket that offers permessage-deflate, to see whether the server accepts it.
    idle     one socket with no subscription, no client traffic and no protocol pings for up to 75 s, to see whether the server pings or closes a silent socket.

The client sends no WebSocket protocol pings in any mode, so a ping logged is the server's.
Total socket time is about 3.5 minutes, and the flag --short halves every window for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/coinut/ws-probe.py [--short] [mode ...]
"""

import asyncio
import collections
import json
import sys
import time

import websockets
from websockets.frames import Opcode

URL = "wss://wsapi.coinut.com"
SCALE = 0.5 if "--short" in sys.argv else 1.0
BOOK_S = 120 * SCALE
IDLE_S = 75 * SCALE
HB_EVERY_S = 20
_nonce = int(time.time()) % 1_000_000


def nonce() -> int:
    global _nonce
    _nonce += 1
    return _nonce


def req(**kw) -> str:
    kw.setdefault("nonce", nonce())
    return json.dumps(kw)


def trim(text: str, n: int = 400) -> str:
    return text if len(text) <= n else text[:n] + f"... ({len(text)} chars)"


async def connect(deflate: bool = False):
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, compression="deflate" if deflate else None, ping_interval=None, open_timeout=20,
                                  max_size=2**24, user_agent_header="arbitrage-observatory-probe/1.0")
    hdrs = ws.response.headers
    print(f"open {round((time.perf_counter() - t0) * 1000)} ms status {ws.response.status_code}",
          "extensions", hdrs.get("Sec-WebSocket-Extensions"), "server", hdrs.get("Server"), "cf-ray", hdrs.get("CF-RAY"))
    return ws


async def recv_until(ws, seconds: float, on_text) -> bool:
    """Feed text frames to on_text for up to seconds. Returns False when the socket closed, after printing when and how."""
    start = time.monotonic()
    end = start + seconds
    last = start
    while (left := end - time.monotonic()) > 0:
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return True
        except websockets.ConnectionClosed as e:
            now = time.monotonic()
            print(f"socket closed {now - start:.1f} s into this window, {now - last:.1f} s after the last data frame,",
                  "code", e.rcvd.code if e.rcvd else None, "reason", repr(e.rcvd.reason) if e.rcvd else None, "error", type(e).__name__, e)
            return False
        last = time.monotonic()
        on_text(msg if isinstance(msg, str) else msg.decode("utf-8", "replace"))
    return True


async def book_mode() -> None:
    print("\n=== book")
    ws = await connect()
    await ws.send(req(request="hb"))
    t0 = time.perf_counter()
    print("hb reply", await ws.recv(), round((time.perf_counter() - t0) * 1000), "ms")
    await ws.send(req(request="inst_list", sec_type="SPOT"))
    inst = json.loads(await ws.recv())["SPOT"]
    ids = {r[0]["inst_id"]: sym for sym, r in inst.items()}
    print("inst_list SPOT over the socket", len(ids), "instruments")
    btc = next(i for i, s in ids.items() if s == "BTCUSDT")
    counts: collections.Counter = collections.Counter()
    updates: list[str] = []
    snaps: dict = {}
    first_frames: dict = {}
    t_start = time.monotonic()

    def on_text(text: str) -> None:
        try:
            d = json.loads(text)
        except json.JSONDecodeError:
            counts["not JSON"] += 1
            print("not JSON", trim(text))
            return
        r = d.get("reply", "?")
        counts[r] += 1
        if r not in first_frames:
            first_frames[r] = trim(text, 600)
        if r == "inst_order_book":
            snaps[(d.get("inst_id"), d.get("nonce") == top_nonce)] = d
        elif r not in ("inst_tick", "inst_trade"):
            updates.append(f"+{time.monotonic() - t_start:6.1f}s {trim(text, 300)}")

    top_nonce = nonce()
    await ws.send(req(request="inst_order_book", inst_id=btc, top_n=10, subscribe=True, nonce=top_nonce))
    await recv_until(ws, 2, on_text)
    for iid in ids:
        await ws.send(req(request="inst_order_book", inst_id=iid, subscribe=True))
        await ws.send(req(request="inst_tick", inst_id=iid, subscribe=True))
        await ws.send(req(request="inst_trade", inst_id=iid, subscribe=True))
        await recv_until(ws, 0.2, on_text)
    print("subscribed book, tick and trade on", len(ids), "instruments")
    t_sub = time.monotonic()
    open_ = True
    while open_ and (left := BOOK_S - (time.monotonic() - t_sub)) > 0:
        open_ = await recv_until(ws, min(HB_EVERY_S, left), on_text)
        if open_ and left > HB_EVERY_S:
            await ws.send(req(request="hb"))
    print(f"window ended after {time.monotonic() - t_sub:.1f} s, socket open {open_}")
    print("frames by reply type over the window", dict(counts))
    print("first frame of each reply type")
    for r, f in first_frames.items():
        print(" ", r, f)
    full = {k[0]: v for k, v in snaps.items() if not k[1]}
    top = snaps.get((btc, True))
    if top:
        print("BTCUSDT top_n 10 snapshot levels", len(top["buy"]), len(top["sell"]), "trans_id", top.get("trans_id"), "keys", sorted(top))
        two = dict(top, buy=top["buy"][:2], sell=top["sell"][:2])
        print("BTCUSDT top_n 10 snapshot trimmed to two levels a side", json.dumps(two, separators=(",", ":")))
    print("full snapshots received", len(snaps), "level counts", {ids.get(i, i): (len(v["buy"]), len(v["sell"])) for i, v in full.items()})
    print("frames other than snapshots, ticks and trade snapshots:", len(updates))
    for u in updates[:20]:
        print(" ", u)
    if open_:
        await ws.close()


async def errors_mode() -> None:
    print("\n=== errors")
    ws = await connect()
    for label, frame in (
        ("unknown inst_id", req(request="inst_order_book", inst_id=999999999, subscribe=True)),
        ("top_n 20", req(request="inst_order_book", inst_id=490589, top_n=20, subscribe=True)),
        ("unknown request", req(request="no_such_request")),
        ("not JSON", "hello"),
        ("nonce out of range", json.dumps({"request": "hb", "nonce": 16777216})),
        ("subscribe then unsubscribe", req(request="inst_tick", inst_id=490589, subscribe=True)),
        ("unsubscribe", req(request="inst_tick", inst_id=490589, subscribe=False)),
        ("private without login", req(request="user_balance")),
    ):
        await ws.send(frame)
        got: list[str] = []
        await recv_until(ws, 2, got.append)
        print(label, "sent", trim(frame, 120))
        for g in got:
            print("   got", trim(g, 300))
        if not got:
            print("   got nothing in 2 s")
    await ws.close()


async def deflate_mode() -> None:
    print("\n=== deflate")
    ws = await connect(deflate=True)
    await ws.close()


async def idle_mode() -> None:
    print("\n=== idle")
    ws = await connect()
    pings = []
    orig = ws.protocol.recv_frame if hasattr(ws, "protocol") else None

    def spy(frame):
        if frame.opcode is Opcode.PING:
            pings.append(round(time.monotonic() - t0, 1))
        return orig(frame)

    if orig:
        ws.protocol.recv_frame = spy
    t0 = time.monotonic()
    try:
        await asyncio.wait_for(ws.recv(), timeout=IDLE_S)
        print("unexpected data frame while idle")
    except asyncio.TimeoutError:
        print(f"socket still open after {IDLE_S:.0f} s of silence")
    except websockets.ConnectionClosed as e:
        print(f"server closed after {time.monotonic() - t0:.1f} s code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None}")
    print("server pings seen at seconds", pings or "none")
    if ws.state.name == "OPEN":
        await ws.send(req(request="hb"))
        print("hb after idle", await ws.recv())
        await ws.close()


async def main() -> None:
    modes = [a for a in sys.argv[1:] if not a.startswith("--")] or ["book", "errors", "deflate", "idle"]
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for m in modes:
        await {"book": book_mode, "errors": errors_mode, "deflate": deflate_mode, "idle": idle_mode}[m]()
    print("\nprobe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
