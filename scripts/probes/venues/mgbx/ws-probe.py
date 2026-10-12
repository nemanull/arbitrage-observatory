# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for the MGBX USDT-M perpetual market socket.

MGBX publishes no socket documentation, so the URL and request frames are the ones the www.mgbx.com futures web app sent when the 2026-09-23 run read its bundle.
Public and unauthenticated. Every mode holds its sockets for at most about two minutes, and the four modes together for under four.
TLS handshakes to www.mgbx.com stall often from this host, so each open has a 6 s timeout and up to five tries.

Run from the repository root:
    uv run scripts/probes/venues/mgbx/ws-probe.py [book|control|bulk|silence]

Modes:
    book     four contracts, one socket each, for 60 s: snapshot on subscribe, levels, the id rule, a replay check and a REST size check.
    control  acknowledgement shape, unknown and wrong-case symbols, an unknown request, a second subscribe, unsubscribe, ping, deflate, a non-JSON frame.
    bulk     sub_tickers and sub_mark_prices for 10 s: rows and cadence.
    silence  one socket with no subscription and one subscribed socket, neither sending anything, for up to 120 s.

Captures go to .claude/survey-work/mgbx/ unless PROBE_OUT_DIR names another folder.
Recorded in docs/profiles/mgbx/websocket.md.
"""

import asyncio
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import websockets

URL = "wss://www.mgbx.com/ws/market"
REST = "https://www.mgbx.com/futures/fapi/market/v1/public"
EPOCH_MS = 1629702000000  # id >> 22 plus this is the delta's t in ms, found on 2026-09-24
REPO = Path(__file__).resolve().parents[4]
OUT = Path(os.environ.get("PROBE_OUT_DIR", REPO / ".claude/survey-work/mgbx"))


def log(tag, **kw):
    print(json.dumps({"tag": tag, **kw}, default=str), flush=True)


def now_ms():
    return time.time() * 1000


def stats(xs):
    if not xs:
        return {"n": 0}
    s = sorted(xs)
    return {"n": len(s), "min": s[0], "median": statistics.median(s), "max": s[-1]}


async def connect(compression=None):
    handshakes = 0
    for attempt in range(5):
        t0 = time.perf_counter()
        try:
            ws = await websockets.connect(URL, open_timeout=6, ping_interval=None, compression=compression, max_size=2**23)
            return ws, round((time.perf_counter() - t0) * 1000), attempt
        except Exception as e:
            handshakes += 1
            last = type(e).__name__
    raise RuntimeError(f"five handshakes failed, last {last}")


async def recv_until(ws, seconds):
    """Every frame received within the window, as (arrival ms, text)."""
    frames = []
    end = time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            msg = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            frames.append((now_ms(), f"<closed {e.rcvd.code if e.rcvd else None}>"))
            break
        frames.append((now_ms(), msg))
    return frames


def parse(text):
    try:
        return json.loads(text)
    except ValueError:
        return None


def rest_depth(symbol):
    for _ in range(3):
        try:
            with urllib.request.urlopen(f"{REST}/q/depth?symbol={symbol}&level=20", timeout=5) as r:
                return json.loads(r.read())["data"]
        except Exception:
            pass
    return None


async def book_one(symbol, seconds):
    ws, open_ms, retries = await connect()
    created = now_ms()
    await ws.send(json.dumps({"req": "sub_symbol", "symbol": symbol}))
    frames = await recv_until(ws, seconds - 4)
    # The REST book is read in a thread while the socket keeps receiving, so a snapshot with the same id can be found.
    rest_task = asyncio.create_task(asyncio.to_thread(rest_depth, symbol))
    frames += await recv_until(ws, 4)
    rest = await rest_task
    rest_at = now_ms()
    await ws.close()
    return symbol, open_ms, retries, created, frames, rest, rest_at


def analyse_book(symbol, open_ms, retries, created, frames, rest, rest_at):
    channels = Counter()
    snaps, deltas = [], []
    first_snap_ms = None
    events = []  # ("s", id, data) or ("d", id, data) in arrival order
    for at, text in frames:
        m = parse(text)
        if not isinstance(m, dict) or "channel" not in m:
            channels[f"text {text[:20]}"] += 1
            continue
        channels[m["channel"]] += 1
        d = m["data"]
        if m["channel"] == "push.deep.full":
            if first_snap_ms is None:
                first_snap_ms = round(at - created)
            snaps.append((at, d))
            events.append(("s", int(d["id"]), d))
        elif m["channel"] == "push.deep":
            deltas.append((at, d))
            events.append(("d", int(d["id"]), d))
    levels = Counter((len(d["b"]), len(d["a"])) for _, d in snaps)
    bids_desc = all(all(float(d["b"][j][0]) < float(d["b"][j - 1][0]) for j in range(1, len(d["b"]))) for _, d in snaps)
    asks_asc = all(all(float(d["a"][j][0]) > float(d["a"][j - 1][0]) for j in range(1, len(d["a"]))) for _, d in snaps)
    crossed = sum(1 for _, d in snaps if d["b"] and d["a"] and float(d["b"][0][0]) >= float(d["a"][0][0]))
    sci = sum(1 for _, d in snaps for lvl in d["b"] + d["a"] if "e" in lvl[1].lower())
    sizes = sum(len(d["b"]) + len(d["a"]) for _, d in snaps)
    delta_sci = sum(1 for _, d in deltas if "e" in d["q"].lower())
    # The id rule: id >> 22 plus the epoch against t.
    decode = Counter(((int(d["id"]) >> 22) + EPOCH_MS) - d["t"] for _, d in deltas)
    ids = [int(d["id"]) for _, d in deltas]
    steps = [b - a for a, b in zip(ids, ids[1:])]
    seen, snap_in_seen, after_le, before_gt, snaps_after_delta = set(), 0, 0, 0, 0
    last_snap = None
    max_delta = -1
    for kind, i, d in events:
        if kind == "d":
            seen.add(i)
            if last_snap is not None and i <= last_snap:
                after_le += 1
            max_delta = max(max_delta, i)
        else:
            if seen:
                snap_in_seen += i in seen
                snaps_after_delta += 1
            before_gt += max_delta > i
            last_snap = i
    # Replay: the previous snapshot plus every delta with an id at or below the next snapshot's id, top 20 per side.
    match = tried = 0
    book = None
    for kind, i, d in events:
        if kind == "s":
            if book is not None:
                tried += 1
                bb = sorted(((p, q) for p, q in book["b"].items() if q > 0), reverse=True)[:20]
                aa = sorted((p, q) for p, q in book["a"].items() if q > 0)[:20]
                sb = [(float(p), float(q)) for p, q in d["b"][:20]]
                sa = [(float(p), float(q)) for p, q in d["a"][:20]]
                match += bb == sb and aa == sa
            book = {"b": {float(p): float(q) for p, q in d["b"]}, "a": {float(p): float(q) for p, q in d["a"]}}
            snap_id = i
        elif book is not None and i > snap_id:
            side = "b" if d["ba"] == 1 else "a"
            book[side][float(d["p"])] = float(d["q"])
    gaps = [b[0] - a[0] for a, b in zip(snaps, snaps[1:])]
    book_frames = sorted(at for at, _ in snaps + deltas)
    delay = [round(at - d["t"]) for at, d in deltas]
    out = {
        "s": symbol, "openMs": open_ms, "handshakeRetries": retries, "channels": dict(channels), "firstSnapshotMs": first_snap_ms,
        "snapshots": len(snaps), "levels": {f"{b}x{a}": n for (b, a), n in levels.items()}, "bidsDesc": bids_desc, "asksAsc": asks_asc, "crossed": crossed,
        "snapshotKeys": list(snaps[0][1].keys()) if snaps else [], "sciSizes": f"{sci} of {sizes}", "deltaSciSizes": f"{delta_sci} of {len(deltas)}",
        "deltas": len(deltas), "deltaKeys": list(deltas[0][1].keys()) if deltas else [], "deltaSides": dict(Counter(d["ba"] for _, d in deltas)),
        "idDecodeMinusT": dict(decode), "idBackwards": sum(1 for x in steps if x <= 0), "idStepOne": f"{sum(1 for x in steps if x == 1)} of {len(steps)}", "idMaxStep": max(steps) if steps else None,
        "snapshotIdIsSeenDelta": f"{snap_in_seen} of {snaps_after_delta} snapshots after the first delta", "deltaAfterSnapAtOrBelow": after_le, "deltaBeforeSnapAbove": before_gt,
        "replayTop20": f"{match} of {tried}", "snapshotGapMs": stats([round(g) for g in gaps]), "maxBookFrameGapMs": round(max((b - a for a, b in zip(book_frames, book_frames[1:])), default=0)),
        "deltaDelayMs": stats(delay), "identicalConsecutiveSnapshots": sum(1 for a, b in zip(snaps, snaps[1:]) if a[1]["b"] == b[1]["b"] and a[1]["a"] == b[1]["a"]),
    }
    if rest and snaps:
        same = [(at, d) for at, d in snaps if int(d["id"]) == int(rest["u"])]
        at, snap = same[0] if same else snaps[-1]
        top = [(float(p), float(q)) for p, q in snap["b"][:20] + snap["a"][:20]]
        rtop = [(float(p), float(q)) for p, q in rest["b"][:20] + rest["a"][:20]]
        out["rest"] = {"snapshotWithRestU": bool(same), "restU": rest["u"], "top40Equal": sum(1 for x, y in zip(top, rtop) if x == y), "snapshotBid": snap["b"][0], "restBid": rest["b"][0]}
    return out


async def book():
    symbols = ["btc_usdt", "eth_usdt", "vst_usdt", "xau_usdt"]
    results = await asyncio.gather(*(book_one(s, 60) for s in symbols), return_exceptions=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for r in results:
        if isinstance(r, Exception):
            log("book_error", error=str(r))
            continue
        log("book", **analyse_book(*r))
        sample = [t for _, t in r[4][:6]] + [t for _, t in r[4] if '"push.deep.full"' in t][:1]
        (OUT / f"ws-book-{r[0]}.txt").write_text("\n".join(sample))


async def control():
    ws, open_ms, retries = await connect(compression="deflate")
    ext = ws.response.headers.get("Sec-WebSocket-Extensions")
    log("deflate_offered", openMs=open_ms, retries=retries, extensionsHeader=ext)
    cases = [
        ("unknown symbol", {"req": "sub_symbol", "symbol": "nope_usdt"}, 3),
        ("upper case symbol", {"req": "sub_symbol", "symbol": "BTC_USDT"}, 3),
        ("delisted symbol burger_usdt", {"req": "sub_symbol", "symbol": "burger_usdt"}, 5),
        ("unknown request", {"req": "sub_nope"}, 2),
        ("json ping", {"ping": round(now_ms())}, 2),
    ]
    for name, frame, wait in cases:
        await ws.send(json.dumps(frame))
        frames = await recv_until(ws, wait)
        log("control", case=name, sent=frame, frames=len(frames), first=[t[:120] for _, t in frames[:3]])
    await ws.send("ping")
    frames = await recv_until(ws, 2)
    log("control", case="text ping", frames=[t for _, t in frames[:3]])
    await ws.send(json.dumps({"req": "sub_symbol", "symbol": "btc_usdt"}))
    a = await recv_until(ws, 3)
    await ws.send(json.dumps({"req": "sub_symbol", "symbol": "eth_usdt"}))
    b = await recv_until(ws, 3)
    sym = lambda fr: dict(Counter((parse(t) or {}).get("data", {}).get("s") if isinstance((parse(t) or {}).get("data"), dict) else None for _, t in fr))
    btc_after = [i for i, (_, t) in enumerate(b) if '"btc_usdt"' in t]
    log("control", case="second sub_symbol", firstWindow=sym(a), secondWindow=sym(b), btcFramesAfterSecondSub=len(btc_after), lastBtcIndex=max(btc_after, default=None))
    await ws.send(json.dumps({"req": "unsub_symbol", "symbol": "eth_usdt"}))
    c = await recv_until(ws, 3)
    log("control", case="unsub_symbol", frames=len(c), first=[t[:80] for _, t in c[:3]], pushesAfterAck=sum(1 for _, t in c if t.startswith('{"channel"')))
    await ws.send("hello")
    d = await recv_until(ws, 3)
    log("control", case="non-JSON text", frames=[t[:80] for _, t in d])
    await ws.close()


async def bulk():
    ws, open_ms, retries = await connect()
    await ws.send(json.dumps({"req": "sub_tickers"}))
    await ws.send(json.dumps({"req": "sub_mark_prices"}))
    frames = await recv_until(ws, 10)
    await ws.close()
    by = {}
    for at, t in frames:
        m = parse(t)
        if isinstance(m, dict) and "channel" in m:
            by.setdefault(m["channel"], []).append((at, m["data"]))
    for ch, items in by.items():
        gaps = [round(b[0] - a[0]) for a, b in zip(items, items[1:])]
        rows = [len(d) if isinstance(d, list) else 1 for _, d in items]
        keys = list(items[0][1][0].keys()) if isinstance(items[0][1], list) and items[0][1] else list(items[0][1].keys()) if isinstance(items[0][1], dict) else []
        log("bulk", channel=ch, pushes=len(items), rows=dict(Counter(rows)), gapsMs=gaps, keys=keys)
    if "push.mark.prices" in by:
        (OUT / "ws-mark-prices.json").write_text(json.dumps(by["push.mark.prices"][-1][1][:3]))


async def silent(subscribe):
    ws, open_ms, retries = await connect()
    t0 = time.monotonic()
    if subscribe:
        await ws.send(json.dumps({"req": "sub_symbol", "symbol": "xau_usdt"}))
    count = 0
    pings = 0
    closed = None
    while time.monotonic() - t0 < 120:
        try:
            msg = await asyncio.wait_for(ws.recv(), 120 - (time.monotonic() - t0))
            count += 1
            pings += msg == "ping"
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            closed = {"atS": round(time.monotonic() - t0, 1), "code": e.rcvd.code if e.rcvd else None}
            break
    if closed is None:
        await ws.close()
    log("silence", subscribed=subscribe, frames=count, serverTextPings=pings, closed=closed, heldS=round(time.monotonic() - t0, 1))


async def silence():
    await asyncio.gather(silent(False), silent(True))


MODES = {"book": book, "control": control, "bulk": bulk, "silence": silence}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "book"
    if mode not in MODES:
        sys.exit(f"unknown mode {mode}, one of {', '.join(MODES)}")
    log("start", mode=mode, at=datetime.now(timezone.utc).isoformat())
    asyncio.run(MODES[mode]())
    log("end", mode=mode, at=datetime.now(timezone.utc).isoformat())
