# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Gems Trade WebSocket probe for docs/profiles/gems-trade/websocket.md.

Public, unauthenticated and read-only, Ranger public endpoint wss://www.gems.trade/api/v2/ranger/public/.
Holds sockets for about three minutes in total.
  1. Handshake: user agent rule, permessage-deflate offer, response headers.
  2. The book stream <market>.update-<n> on btcusdt for 30 s: cadence, levels, order, keys, repeats.
  3. Which suffix n gives the raw book, for three markets with different price precision.
  3b. Openware's stream names ob-inc, ob-snap, depth and the plain update.
  4. Twenty markets on one socket for 20 s.
  5. Subscribe and unsubscribe frames on an open socket, an unknown market, and a malformed frame.
  6. Other public streams: <market>.d-v, <market>.ticker, <market>.trades, global.tickers.
  7. Keepalive: a client ping, and 75 s with no stream and no client ping.
Run from the repository root with: uv run scripts/probes/venues/gems-trade/ws-probe.py
Pass section names, such as "openware", to run only those.
"""

import asyncio
import json
import statistics
import sys
import time
import urllib.request

import websockets
from websockets.http11 import USER_AGENT as WS_DEFAULT_UA

BASE = "wss://www.gems.trade/api/v2/ranger/public/"
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"
ORIGIN = "https://www.gems.trade"


def url(streams):
    return BASE + ("?" + "&".join("stream=" + s for s in streams) if streams else "")


def connect(streams, ua=FIREFOX, compression=None, ping_interval=None):
    return websockets.connect(url(streams), user_agent_header=ua, origin=ORIGIN, compression=compression,
                              ping_interval=ping_interval, max_size=None, open_timeout=20)


def trim(s, n=300):
    return s if len(s) <= n else s[:n] + f"... ({len(s)} chars)"


async def collect(ws, seconds):
    out = []
    t0 = time.monotonic()
    while True:
        left = seconds - (time.monotonic() - t0)
        if left <= 0:
            break
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        out.append((time.monotonic() - t0, m))
    return out


async def handshake():
    print("== 1. Handshake")
    for label, ua in (("bare Mozilla/5.0", "Mozilla/5.0"), ("websockets default", WS_DEFAULT_UA), ("full Firefox", FIREFOX)):
        try:
            async with connect(["btcusdt.d-v"], ua=ua) as ws:
                print(f"  UA {label}: HTTP {ws.response.status_code}")
        except websockets.exceptions.InvalidStatus as e:
            print(f"  UA {label}: HTTP {e.response.status_code}, body {e.response.body[:60]!r}")
    async with connect(["btcusdt.d-v"], compression="deflate") as ws:
        h = ws.response.headers
        print(f"  offered permessage-deflate: accepted extensions {h.get('Sec-WebSocket-Extensions')!r}, server {h.get('Server')}, x-cache {h.get('X-Cache')}")
        first = await asyncio.wait_for(ws.recv(), timeout=10)
        print(f"  first frame: {first}")


def book_stats(frames, key):
    gaps, levels_a, levels_b, keys, repeats, crossed, order_ok, sci = [], [], [], set(), 0, 0, True, 0
    last_t, last_body = None, None
    for t, m in frames:
        d = json.loads(m)
        if key not in d:
            continue
        b = d[key]
        keys |= set(b)
        if last_t is not None:
            gaps.append((t - last_t) * 1000)
        last_t = t
        body = json.dumps(b, sort_keys=True)
        repeats += body == last_body
        last_body = body
        asks, bids = b.get("asks", []), b.get("bids", [])
        levels_a.append(len(asks))
        levels_b.append(len(bids))
        ap, bp = [float(p) for p, _ in asks], [float(p) for p, _ in bids]
        order_ok &= ap == sorted(ap) and bp == sorted(bp, reverse=True)
        if ap and bp and bp[0] >= ap[0]:
            crossed += 1
        sci += any("e" in q.lower() for _, q in asks + bids)
    return gaps, levels_a, levels_b, keys, repeats, crossed, order_ok, sci


async def book():
    print("== 2. btcusdt.update-1 for 30 s")
    key = "btcusdt.update-1"
    async with connect([key]) as ws:
        frames = await collect(ws, 30)
    print(f"  first frame: {trim(frames[0][1], 160)}")
    second = json.loads(frames[1][1])[key]
    print(f"  second frame, three levels per side of {len(second['asks'])} and {len(second['bids'])}: {json.dumps({key: {'asks': second['asks'][:3], 'bids': second['bids'][:3]}}, separators=(',', ':'))}")
    n = sum(1 for _, m in frames if key in m)
    gaps, la, lb, keys, repeats, crossed, order_ok, sci = book_stats(frames, key)
    print(f"  book frames {n} in 30 s, gap median {statistics.median(gaps):.0f} ms, p90 {sorted(gaps)[int(len(gaps) * 0.9)]:.0f} ms, max {max(gaps):.0f} ms")
    print(f"  keys in the book object {sorted(keys)}, levels per frame asks {min(la)} to {max(la)}, bids {min(lb)} to {max(lb)}")
    print(f"  asks ascending and bids descending in every frame {order_ok}, crossed frames {crossed}, frames identical to the previous one {repeats}")
    print(f"  frames with a size in exponent notation {sci} of {n}")
    print(f"  frame size median {statistics.median(len(m) for _, m in frames if key in m):.0f} chars")
    last = json.loads(frames[-1][1])[key]
    print(f"  last frame top: bid {last['bids'][0]}, ask {last['asks'][0]}")
    req = urllib.request.Request("https://www.gems.trade/api/v2/peatio/public/markets/btcusdt/depth?limit=5", headers={"User-Agent": FIREFOX})
    rest = json.loads(urllib.request.urlopen(req, timeout=30).read())
    print(f"  REST depth right after: bid {rest['bids'][0]}, ask {rest['asks'][0]}")


async def precision():
    print("== 3. Suffix n of <market>.update-<n>")
    for mid, pp in (("btcusdt", 1), ("ethusdt", 2), ("xrpusdt", 4)):
        streams = [f"{mid}.update-{k}" for k in range(0, pp + 3)] + [f"{mid}.update-10", f"{mid}.update-0.1"]
        async with connect(streams) as ws:
            frames = await collect(ws, 6)
        ack = json.loads(frames[0][1])
        print(f"  {mid}, price_precision {pp}: ack {ack}")
        seen = {}
        for _, m in frames[1:]:
            d = json.loads(m)
            for k, v in d.items():
                if k not in seen:
                    seen[k] = v
        for s in streams:
            v = seen.get(s)
            if v is None:
                print(f"    {s}: no frame in 6 s")
            else:
                prices = [p for p, _ in v["asks"][:4]]
                print(f"    {s}: asks {len(v['asks'])}, bids {len(v['bids'])}, first ask prices {prices}")


async def openware():
    print("== 3b. Openware stream names")
    streams = ["btcusdt.ob-inc", "btcusdt.ob-snap", "btcusdt.depth", "btcusdt.update"]
    async with connect(streams) as ws:
        frames = await collect(ws, 6)
    keys = sorted({k for _, m in frames[1:] for k in json.loads(m)})
    print(f"  {streams}: ack {json.loads(frames[0][1])}, frames in 6 s {len(frames) - 1}, keys {keys}")
    async with connect(["btcusdt.update", "btcusdt.update-1"]) as ws:
        frames = await collect(ws, 10)
    plain = [json.loads(m)["btcusdt.update"] for _, m in frames[1:] if "btcusdt.update" in json.loads(m)]
    raw = [json.loads(m)["btcusdt.update-1"] for _, m in frames[1:] if "btcusdt.update-1" in json.loads(m)]
    print(f"  btcusdt.update beside btcusdt.update-1 for 10 s: {len(plain)} and {len(raw)} frames")
    if plain:
        f = plain[0]
        print(f"  btcusdt.update keys {sorted(f)}, levels asks {len(f.get('asks', []))}, bids {len(f.get('bids', []))}, first three asks {f.get('asks', [])[:3]}")
        same = sum(1 for p in plain if any(p == r for r in raw))
        print(f"  btcusdt.update frames equal to some btcusdt.update-1 frame: {same} of {len(plain)}")
        gaps, la, lb, keys, repeats, crossed, order_ok, sci = book_stats(frames, "btcusdt.update")
        print(f"  btcusdt.update levels per frame asks {min(la)} to {max(la)}, bids {min(lb)} to {max(lb)}, gap median {statistics.median(gaps):.0f} ms")
        print(f"  ordered in every frame {order_ok}, crossed frames {crossed}, repeats {repeats}, frames with exponent sizes {sci}")
        types = {(type(p).__name__, type(q).__name__) for b in plain for p, q in b["asks"] + b["bids"]}
        print(f"  price and size JSON types: {sorted(types)}")
        top_p = (plain[-1]["bids"][0], plain[-1]["asks"][0])
        top_r = next(((r["bids"][0], r["asks"][0]) for r in reversed(raw)), None)
        print(f"  last tops, update {top_p} and update-1 {top_r}")
        print(f"  frame size median {statistics.median(len(m) for _, m in frames if 'btcusdt.update\"' in m):.0f} chars")


async def many():
    print("== 4. Twenty markets on one socket for 20 s")
    req = urllib.request.Request("https://www.gems.trade/api/v2/peatio/public/markets", headers={"User-Agent": FIREFOX})
    markets = json.loads(urllib.request.urlopen(req, timeout=30).read())
    pick = [m for m in markets if m["upstream"]][:17] + [m for m in markets if not m["upstream"]][:3]
    streams = [f"{m['id']}.update-{m['price_precision']}" for m in pick]
    print(f"  URL length {len(url(streams))}")
    async with connect(streams) as ws:
        frames = await collect(ws, 20)
    ack = json.loads(frames[0][1])
    print(f"  ack lists {len(ack['success']['streams'])} streams")
    per = {s: 0 for s in streams}
    for _, m in frames[1:]:
        for k in json.loads(m):
            if k in per:
                per[k] += 1
    for s in streams:
        print(f"    {s}: {per[s]} frames")
    multi = sum(1 for _, m in frames[1:] if len(json.loads(m)) > 1)
    print(f"  frames carrying more than one stream key: {multi} of {len(frames) - 1}")


async def control():
    print("== 5. Control frames")
    async with connect([]) as ws:
        first = await collect(ws, 3)
        print(f"  no stream in the URL, frames in 3 s: {[m for _, m in first]}")
        await ws.send(json.dumps({"event": "subscribe", "streams": ["ethusdt.update-2"]}))
        got = await collect(ws, 3)
        print(f"  subscribe ethusdt.update-2: {len(got)} frames, first {trim(got[0][1], 120) if got else None}")
        await ws.send(json.dumps({"event": "unsubscribe", "streams": ["ethusdt.update-2"]}))
        got = await collect(ws, 3)
        acks = [m for _, m in got if "success" in m or "error" in m]
        print(f"  unsubscribe: control replies {acks}")
        tail = await collect(ws, 2)
        print(f"  book frames after unsubscribe settled: {sum(1 for _, m in tail if 'update' in m)}")
        await ws.send(json.dumps({"event": "subscribe", "streams": ["foousdt.update-1"]}))
        got = await collect(ws, 4)
        print(f"  subscribe unknown foousdt.update-1: {[trim(m, 160) for _, m in got]}")
        await ws.send("not json")
        got = await collect(ws, 3)
        print(f"  malformed frame: {[trim(m, 160) for _, m in got]}, socket open {ws.state.name}")


async def others():
    print("== 6. Other public streams")
    streams = ["btcusdt.d-v", "btcusdt.ticker", "btcusdt.trades", "global.tickers"]
    async with connect(streams) as ws:
        frames = await collect(ws, 10)
    first = {}
    count = {}
    for _, m in frames[1:]:
        for k, v in json.loads(m).items():
            count[k] = count.get(k, 0) + 1
            first.setdefault(k, v)
    for s in streams:
        v = first.get(s)
        print(f"  {s}: {count.get(s, 0)} frames in 10 s, sample {trim(json.dumps(v), 260) if v is not None else None}")


async def keepalive():
    print("== 7. Keepalive")
    async with connect(["btcusdt.d-v"]) as ws:
        t0 = time.monotonic()
        pong = await ws.ping()
        await asyncio.wait_for(pong, timeout=10)
        print(f"  client ping answered by a pong in {(time.monotonic() - t0) * 1000:.0f} ms")
        await ws.send("ping")
        got = await collect(ws, 2)
        print(f"  text 'ping': replies other than d-v {[m for _, m in got if 'd-v' not in m]}")
    async with connect([]) as ws:
        t0 = time.monotonic()
        try:
            while time.monotonic() - t0 < 75:
                await asyncio.wait_for(ws.recv(), timeout=75 - (time.monotonic() - t0))
        except asyncio.TimeoutError:
            print(f"  no stream, no client ping: still open after {time.monotonic() - t0:.0f} s, state {ws.state.name}")
        except websockets.exceptions.ConnectionClosed as e:
            print(f"  no stream, no client ping: closed after {time.monotonic() - t0:.0f} s, code {e.rcvd.code if e.rcvd else None}, reason {e.rcvd.reason if e.rcvd else None!r}")


SECTIONS = {"handshake": handshake, "book": book, "precision": precision, "openware": openware, "many": many,
            "control": control, "others": others, "keepalive": keepalive}


async def main(names):
    t0 = time.monotonic()
    for name in names or SECTIONS:
        await SECTIONS[name]()
    print(f"== total wall time {time.monotonic() - t0:.0f} s")


if __name__ == "__main__":
    # Optional section names, such as "book openware", run only those sections.
    asyncio.run(main(sys.argv[1:]))
