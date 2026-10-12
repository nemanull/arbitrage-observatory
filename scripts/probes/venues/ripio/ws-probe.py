# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Ripio Trade public WebSocket stream probe, read-only and unauthenticated.

The URL wss://ws.ripiotrade.co, the methods subscribe, unsubscribe and ping, and the topic names come from the v4 API documentation at https://apidocs.ripiotrade.co/.

Run from the repository root: uv run scripts/probes/venues/ripio/ws-probe.py [mode]
Modes and their socket time:
  session  about 75 s: level_2_delta, level_2 and ticker on BTC_USDC and ETH_USDC, a ping, an unknown pair, a bad topic, a bad method
  bulk     about 40 s: level_2_delta on every enabled pair in one subscribe frame
  silence  up to 120 s: subscribe one level_2 topic, never send anything, record server pings and whether the socket closes
  all      session, bulk and silence in turn (the default)
"""

import asyncio
import collections
import json
import logging
import sys
import time
import urllib.request

import websockets

WS = "wss://ws.ripiotrade.co"
PAIRS = "https://api.ripiotrade.co/v4/public/pairs"
UA = "arbitrage-observatory venue survey probe"


def enabled_pairs():
    req = urllib.request.Request(PAIRS, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [p["symbol"] for p in json.loads(r.read())["data"] if p["enabled"]]


def connect():
    # compression=None refuses permessage-deflate, as the engine's sockets do.
    return websockets.connect(WS, compression=None, max_size=2**24, ping_interval=None, user_agent_header=UA)


def trim(obj, n=600):
    s = obj if isinstance(obj, str) else json.dumps(obj)
    return s if len(s) <= n else s[:n] + " ...trimmed"


def book_ok(body):
    """Checks level order and crossing of one book body, bids descending and asks ascending."""
    bids = [lv["price"] for lv in body.get("bids", [])]
    asks = [lv["price"] for lv in body.get("asks", [])]
    desc = all(a > b for a, b in zip(bids, bids[1:]))
    asc = all(a < b for a, b in zip(asks, asks[1:]))
    crossed = bool(bids and asks and bids[0] >= asks[0])
    return len(bids), len(asks), desc, asc, crossed


class Book:
    def __init__(self):
        self.bids, self.asks = {}, {}

    def apply(self, body, replace):
        if replace:
            self.bids, self.asks = {}, {}
        for side, levels in (("bids", body.get("bids", [])), ("asks", body.get("asks", []))):
            book = getattr(self, side)
            for lv in levels:
                if lv["amount"] == 0:
                    book.pop(lv["price"], None)
                else:
                    book[lv["price"]] = lv["amount"]

    def top(self, n):
        return sorted(self.bids.items(), reverse=True)[:n], sorted(self.asks.items())[:n]


async def read_for(ws, seconds, sink):
    end = time.monotonic() + seconds
    while True:
        left = end - time.monotonic()
        if left <= 0:
            return
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return
        sink(time.time(), raw)


async def session():
    print("\n=== session")
    frames = []
    async with connect() as ws:
        print(f"handshake ok, status={ws.response.status_code}, Sec-WebSocket-Extensions={ws.response.headers.get('Sec-WebSocket-Extensions')!r}")
        print(f"server header={ws.response.headers.get('Server')!r}")
        sub = {"method": "subscribe", "topics": [f"{t}@{p}" for p in ("BTC_USDC", "ETH_USDC") for t in ("orderbook/level_2_delta", "orderbook/level_2", "ticker")]}
        t_sub = time.time()
        await send(ws, frames, sub)
        await read_for(ws, 20, lambda t, r: frames.append((t, r)))
        await send(ws, frames, {"method": "ping"})
        await read_for(ws, 5, lambda t, r: frames.append((t, r)))
        t_ping = time.perf_counter()
        pong = await ws.ping()
        await asyncio.wait_for(pong, timeout=10)
        frames.append((time.time(), ("note", f"protocol PING from the client answered with a PONG in {(time.perf_counter() - t_ping) * 1000:.0f} ms")))
        for probe in (
            {"method": "subscribe", "topics": ["orderbook/level_2_delta@NOPE_USDC"]},
            {"method": "subscribe", "topics": ["orderbook/level_7@BTC_USDC"]},
            {"method": "hello", "topics": ["ticker@BTC_USDC"]},
            "not json",
            {"method": "unsubscribe", "topics": ["ticker@ETH_USDC"]},
        ):
            await send(ws, frames, probe)
            await read_for(ws, 4, lambda t, r: frames.append((t, r)))
        await read_for(ws, 40, lambda t, r: frames.append((t, r)))
    save(frames, "ws-session-frames.jsonl")

    kinds = collections.Counter()
    last_id = {}
    books = collections.defaultdict(Book)
    l2 = {}
    times = collections.defaultdict(list)
    shown = collections.Counter()
    for t, raw in frames:
        rel = t - t_sub
        if isinstance(raw, tuple):
            print(f"+{rel:6.2f}s {raw[0]} {raw[1]}")
            continue
        try:
            msg = json.loads(raw)
        except ValueError:
            kinds["text"] += 1
            print(f"+{rel:6.2f}s text {trim(raw)}")
            continue
        if not isinstance(msg, dict) or "body" not in msg:
            kinds["control"] += 1
            print(f"+{rel:6.2f}s control {trim(msg)}")
            continue
        topic = msg["topic"]
        kinds[topic.split("@")[0]] += 1
        times[topic].append(t)
        mid, body = msg.get("id"), msg["body"]
        prev = last_id.get(topic)
        step = "first" if prev is None else ("+1" if mid == prev + 1 else f"jump {prev} to {mid}")
        last_id[topic] = mid
        if "bids" in body:
            nb, na, desc, asc, crossed = book_ok(body)
            zeros = sum(1 for side in ("bids", "asks") for lv in body[side] if lv["amount"] == 0)
            if shown[topic] < 6 or step not in ("+1",):
                print(f"+{rel:6.2f}s {topic} id={mid} {step} ts={msg.get('timestamp')} bids={nb} asks={na} zero_levels={zeros} bids_desc={desc} asks_asc={asc} crossed={crossed} hash={body.get('hash')}")
            shown[topic] += 1
            if topic.startswith("orderbook/level_2_delta@"):
                books[topic].apply(body, replace=(len(times[topic]) == 1))
            else:
                l2[topic.split("@")[1]] = body
        elif shown[topic] < 2 or step != "+1":
            print(f"+{rel:6.2f}s {topic} id={mid} {step} ts={msg.get('timestamp')} {trim(body, 200)}")
            shown[topic] += 1

    print("frame kinds", dict(kinds))
    for topic, ts in sorted(times.items()):
        iv = [b - a for a, b in zip(ts, ts[1:])]
        print(f"{topic}: {len(ts)} frames, last id {last_id.get(topic)}, max interval {max(iv) if iv else 0:.2f}s")
    for topic in sorted(times):
        msgs = [json.loads(r) for _, r in frames if isinstance(r, str) and r.startswith('{"body"') and json.loads(r).get("topic") == topic][:2]
        for m in msgs:
            print(f"sample {topic}: {trim(m, 500)}")
    for pair, body in l2.items():
        b, a = books[f"orderbook/level_2_delta@{pair}"].top(20)
        lb = [(lv["price"], lv["amount"]) for lv in body["bids"][:20]]
        la = [(lv["price"], lv["amount"]) for lv in body["asks"][:20]]
        print(f"{pair}: book built from level_2_delta, top 20, equals the last level_2 frame: bids {b == lb}, asks {a == la}")


async def send(ws, frames, obj):
    text = obj if isinstance(obj, str) else json.dumps(obj)
    await ws.send(text)
    frames.append((time.time(), ("sent", text)))


def save(frames, name):
    """Writes the raw frames to the gitignored work folder when it exists."""
    import pathlib

    work = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "ripio"
    if not work.is_dir():
        return
    with open(work / name, "w") as f:
        for t, raw in frames:
            f.write(json.dumps({"t": t, "raw": raw if isinstance(raw, str) else list(raw)}) + "\n")
    print(f"raw frames saved to {work / name}")


async def bulk():
    print("\n=== bulk")
    pairs = enabled_pairs()
    topics = [f"orderbook/level_2_delta@{p}" for p in pairs]
    frames = []
    async with connect() as ws:
        frame = json.dumps({"method": "subscribe", "topics": topics})
        t0 = time.time()
        await ws.send(frame)
        print(f"sent one subscribe frame with {len(topics)} topics, {len(frame)} bytes")
        await read_for(ws, 40, lambda t, r: frames.append((t, r)))
    got = collections.Counter()
    acks = collections.Counter()
    first_at = {}
    last_id = {}
    gaps = collections.Counter()
    for t, raw in frames:
        try:
            msg = json.loads(raw)
        except Exception:
            continue
        topic = msg.get("topic") if isinstance(msg, dict) else None
        if topic and "body" not in msg:
            acks[topic] += 1
        elif topic:
            got[topic] += 1
            first_at.setdefault(topic, t - t0)
            mid = msg.get("id")
            if topic in last_id and last_id[topic] >= 0 and mid != last_id[topic] + 1:
                gaps[topic] += 1
            last_id[topic] = mid
        else:
            print("control", trim(msg))
    print(f"{len(acks)} of {len(topics)} topics acknowledged, {len(got)} sent at least one data frame in 40 s, {sum(got.values())} data frames")
    print("topics with no data frame:", sorted(set(topics) - set(got)))
    print("topics whose only data frame was the snapshot:", sorted(k for k, v in got.items() if v == 1))
    print("id steps other than +1 after the first update:", dict(gaps))
    lat = sorted(first_at.values())
    if lat:
        print(f"snapshot latency after subscribe: min {lat[0]:.2f}s, median {lat[len(lat) // 2]:.2f}s, max {lat[-1]:.2f}s")
    print("frames per topic:", dict(sorted(got.items(), key=lambda kv: -kv[1])))


class PingLog(logging.Handler):
    """Records the arrival of server PING control frames from the websockets debug log."""

    def __init__(self):
        super().__init__()
        self.at = []

    def emit(self, record):
        if record.getMessage().startswith("< PING"):
            self.at.append(time.monotonic())


async def silence():
    print("\n=== silence")
    t0 = time.monotonic()
    pings = PingLog()
    logger = logging.getLogger("websockets.client")
    logger.setLevel(logging.DEBUG)
    logger.addHandler(pings)
    async with connect() as ws:
        await ws.send(json.dumps({"method": "subscribe", "topics": ["orderbook/level_2@USDC_USDT"]}))
        n = 0
        try:
            while time.monotonic() - t0 < 120:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=120 - (time.monotonic() - t0))
                except asyncio.TimeoutError:
                    break
                n += 1
                msg = json.loads(raw) if isinstance(raw, str) and raw.startswith("{") else raw
                print(f"+{time.monotonic() - t0:6.1f}s frame {n} id={msg.get('id') if isinstance(msg, dict) else None} {trim(msg, 120)}")
            print(f"socket still open after {time.monotonic() - t0:.0f}s with the client silent, {n} frames")
        except websockets.ConnectionClosed as e:
            print(f"closed after {time.monotonic() - t0:.1f}s: code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None!r}")
    logger.removeHandler(pings)
    print(f"protocol PING control frames received from the server: {len(pings.at)} at {[round(t - t0, 1) for t in pings.at]}s, each answered by the library with a PONG")


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"Ripio WS probe, mode {mode}, started {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    if mode in ("session", "all"):
        await session()
    if mode in ("bulk", "all"):
        await bulk()
    if mode in ("silence", "all"):
        await silence()


asyncio.run(main())
