# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""SuperEx public WebSocket probe, read-only and unauthenticated.

The socket URL wss://api.superexchang.com/socket/ws and the topic names come from the web app bundle at https://www.superex.live.
SuperEx publishes no WebSocket documentation.

Run from the repository root: uv run scripts/probes/venues/superex/ws-probe.py [mode]
Modes and their socket time:
  session  about 45 s: btc_usdt and eth_usdt book, ticker, mark, index and funding, plus an unknown symbol and a ping
  bulk     about 45 s: every listed perpetual's book on one socket, one oversized subscribe frame, then every mark, index and funding topic in 4 KB frames
  silence  up to 150 s: subscribe once, never ping, wait for the server to close
  all      session, bulk and silence in turn (the default)
"""

import asyncio
import base64
import collections
import json
import sys
import time
import urllib.request
import zlib

import websockets

WS = "wss://api.superexchang.com/socket/ws"
ORIGIN = "https://www.superex.live"
CATALOG = "https://api.superexchang.com/swap/front/swap"


HEADERS = collections.Counter()  # first two bytes of each base64 payload, 789c is a zlib header and 1f8b is gzip


def decode(raw):
    """Data frames are text holding base64 of a compressed JSON document, the way the web app's inflate step expects.

    Returns kind "json" for any decoded JSON document, whether it arrived plain or compressed.
    """
    if isinstance(raw, bytes):
        return "binary", raw
    if raw in ("ping", "pong"):
        return "text", raw
    try:
        return "json", json.loads(raw)
    except ValueError:
        pass
    try:
        blob = base64.b64decode(raw)
        HEADERS[blob[:2].hex()] += 1
        return "json", json.loads(zlib.decompress(blob, 47))
    except Exception:
        return "unknown", raw


def connect():
    return websockets.connect(WS, compression=None, origin=ORIGIN, max_size=2**24, ping_interval=None)


def catalog():
    req = urllib.request.Request(CATALOG, headers={"User-Agent": "arbitrage-observatory venue survey probe"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [row["symbol"] for row in json.loads(r.read())["data"] if row["state"] == 1]


def trim(obj, n=500):
    s = json.dumps(obj) if not isinstance(obj, str) else obj
    return s if len(s) <= n else s[:n] + " ...trimmed"


async def session():
    print("\n=== session")
    async with connect() as ws:
        neg = ws.response.headers.get("Sec-WebSocket-Extensions")
        print(f"handshake ok, Sec-WebSocket-Extensions={neg!r}")
        topics = []
        for sym in ["btc_usdt", "eth_usdt"]:
            topics += [f"swap/{t}:{sym}" for t in ["depth", "ticker", "mark_price", "index_ticker", "funding_rate"]]
        await ws.send(json.dumps({"op": "sub", "args": topics}))
        t0 = time.time()
        acks, kinds = [], collections.Counter()
        depth = collections.defaultdict(list)  # symbol: [(t, frame)]
        other = collections.defaultdict(list)
        first = {}
        clock = []
        sent_extra = False
        pong_at = None
        ping_sent = None
        while time.time() - t0 < 40:
            if not sent_extra and time.time() - t0 > 20:
                await ws.send(json.dumps({"op": "sub", "args": ["swap/depth:nope_usdt", "swap/mark_price:nope_usdt"]}))
                await ws.send(json.dumps({"op": "bogus", "args": ["swap/depth:btc_usdt"]}))
                ping_sent = time.time()
                await ws.send("ping")
                sent_extra = True
            try:
                raw = await asyncio.wait_for(ws.recv(), 2)
            except asyncio.TimeoutError:
                continue
            now = time.time()
            kind, msg = decode(raw)
            kinds[kind] += 1
            if sum(kinds.values()) == 1:
                print(f"first raw frame, {len(raw)} chars: {raw[:96]!r}")
            if msg == "pong":
                pong_at = now
                print(f"pong after {1000 * (now - ping_sent):.0f} ms, frame={raw!r}")
                continue
            if kind != "json":
                print(f"non-json frame kind={kind}: {trim(str(msg), 200)}")
                continue
            if "event" in msg or "table" not in msg:
                acks.append(msg)
                if sent_extra:
                    print(f"reply after the extra subscribe: {trim(msg, 300)}")
                continue
            table, sym = msg["table"], msg.get("symbol")
            if "timeStamp" in msg:
                clock.append(now * 1000 - msg["timeStamp"])
            first.setdefault(table, msg)
            if table == "swap/depth":
                depth[sym].append((now, msg))
            else:
                other[(table, sym)].append((now, msg))
        print(f"frame kinds: {dict(kinds)} base64 payload headers: {dict(HEADERS)}")
        print(f"acks before the extra subscribe: {[trim(a, 120) for a in acks[:10]]}")
        for table, msg in first.items():
            print(f"first {table}: {trim(msg, 420)}")
        for sym, frames in depth.items():
            actions = collections.Counter(m.get("action") for _, m in frames)
            nb = [len(m["data"].get("bids", [])) for _, m in frames]
            na = [len(m["data"].get("asks", [])) for _, m in frames]
            gaps = [round(1000 * (b[0] - a[0])) for a, b in zip(frames, frames[1:])] or [0]
            if not nb or (max(nb) == 0 and max(na) == 0):
                print(f"depth {sym}: frames={len(frames)} first={trim(frames[0][1], 300)}")
                continue
            same = sum(1 for a, b in zip(frames, frames[1:]) if a[1]["data"] == b[1]["data"])
            d0 = frames[0][1]["data"]
            asks_up = all(x["price"] < y["price"] for x, y in zip(d0["asks"], d0["asks"][1:]))
            bids_down = all(x["price"] > y["price"] for x, y in zip(d0["bids"], d0["bids"][1:]))
            keys = sorted(frames[0][1].keys())
            print(
                f"depth {sym}: frames={len(frames)} actions={dict(actions)} bids per frame min/max={min(nb)}/{max(nb)} "
                f"asks min/max={min(na)}/{max(na)} interval ms min/median/max={min(gaps)}/{sorted(gaps)[len(gaps) // 2]}/{max(gaps)} "
                f"identical-to-previous={same} asks ascending={asks_up} bids descending={bids_down} frame keys={keys} "
                f"data keys={sorted(d0.keys())}"
            )
            print(f"  best bid={d0['bids'][0]} best ask={d0['asks'][0]}")
        for (table, sym), frames in sorted(other.items()):
            vals = [m.get("data", "NO DATA KEY: " + trim(m, 160)) for _, m in frames]
            distinct = len({json.dumps(v, sort_keys=True) for v in vals})
            gaps = [round(1000 * (b[0] - a[0])) for a, b in zip(frames, frames[1:])] or [0]
            print(f"{table} {sym}: frames={len(frames)} distinct={distinct} interval ms median={sorted(gaps)[len(gaps) // 2]} last={trim(vals[-1], 160)}")
        if clock:
            clock.sort()
            print(f"local receive minus frame timeStamp, ms: min={clock[0]:.0f} median={clock[len(clock) // 2]:.0f} max={clock[-1]:.0f}")
        print(f"pong received={pong_at is not None}")


async def bulk():
    print("\n=== bulk")
    syms = catalog()
    print(f"active perpetuals in the catalog: {len(syms)}")
    async with connect() as ws:
        frame = json.dumps({"op": "sub", "args": [f"swap/depth:{s}" for s in syms]})
        print(f"book subscribe frame bytes={len(frame)}")
        await ws.send(frame)
        t0, seen, acks, errs, nframes, empty, one_sided = time.time(), {}, 0, [], 0, set(), set()
        per = collections.defaultdict(lambda: [0, 0])  # symbol: [frames, empty frames]
        while time.time() - t0 < 15:
            try:
                raw = await asyncio.wait_for(ws.recv(), 2)
            except asyncio.TimeoutError:
                continue
            kind, msg = decode(raw)
            if kind != "json":
                continue
            if "event" in msg:
                acks += msg.get("event") == "sub"
                if msg.get("event") != "sub":
                    errs.append(msg)
                continue
            if msg.get("table") == "swap/depth":
                nframes += 1
                d = msg["data"]
                seen.setdefault(msg["symbol"], time.time() - t0)
                b, a = len(d.get("bids", [])), len(d.get("asks", []))
                per[msg["symbol"]][0] += 1
                if not b and not a:
                    empty.add(msg["symbol"])
                    per[msg["symbol"]][1] += 1
                elif not b or not a:
                    one_sided.add(msg["symbol"])
        late = sorted(seen.values())
        print(
            f"one socket, one subscribe frame with {len(syms)} topics: acks={acks} other events={[trim(e, 120) for e in errs[:3]]} "
            f"symbols with a book frame in 15 s={len(seen)} frames={nframes} first-frame s median/max={late[len(late) // 2]:.2f}/{late[-1]:.2f} "
            f"empty books={len(empty)}: {sorted(empty)} one-sided={sorted(one_sided)}"
        )
        print(f"silent symbols: {sorted(set(syms) - set(seen))}")
        always = sorted(k for k, (n, e) in per.items() if e == n)
        some = sorted(k for k, (n, e) in per.items() if 0 < e < n)
        print(f"empty in every frame: {len(always)}: {always}")
        print(f"empty in some frames only: {len(some)}: {[(k, per[k][1], per[k][0]) for k in some]}")
        print(f"frames per symbol in 15 s, min/median/max: {min(n for n, _ in per.values())}/{sorted(n for n, _ in per.values())[len(per) // 2]}/{max(n for n, _ in per.values())}")
    args = []
    for s in syms:
        args += [f"swap/mark_price:{s}", f"swap/index_ticker:{s}", f"swap/funding_rate:{s}"]
    async with connect() as ws:
        frame = json.dumps({"op": "sub", "args": args})
        await ws.send(frame)
        try:
            while True:
                await asyncio.wait_for(ws.recv(), 10)
        except websockets.ConnectionClosed as e:
            print(f"one subscribe frame of {len(frame)} bytes: closed, code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None!r}")
        except asyncio.TimeoutError:
            print(f"one subscribe frame of {len(frame)} bytes: no close within 10 s")
    async with connect() as ws:
        step = 150  # topics per frame, about 4 KB
        sizes = []
        for i in range(0, len(args), step):
            frame = json.dumps({"op": "sub", "args": args[i : i + step]})
            sizes.append(len(frame))
            await ws.send(frame)
        print(f"anchor topics={len(args)} sent in {len(sizes)} frames, largest {max(sizes)} bytes")
        t0, got = time.time(), collections.defaultdict(set)
        sample = {}
        while time.time() - t0 < 15:
            try:
                raw = await asyncio.wait_for(ws.recv(), 2)
            except asyncio.TimeoutError:
                continue
            kind, msg = decode(raw)
            if kind == "json" and "table" in msg:
                if "data" in msg:
                    got[msg["table"]].add(msg["symbol"])
                sample.setdefault(msg["table"], msg)
        for table in ["swap/mark_price", "swap/index_ticker", "swap/funding_rate"]:
            print(f"{table}: symbols with a data field in 15 s={len(got[table])} of {len(syms)}")
        fr = [s for s in syms if s not in got["swap/funding_rate"]]
        print(f"no funding frame: {fr[:40]}")
        for t, m in sample.items():
            print(f"sample {t}: {trim(m, 220)}")


async def silence():
    print("\n=== silence")
    async with connect() as ws:
        await ws.send(json.dumps({"op": "sub", "args": ["swap/mark_price:btc_usdt"]}))
        t0 = time.time()
        frames, server_pings = 0, []
        try:
            while time.time() - t0 < 150:
                raw = await asyncio.wait_for(ws.recv(), 150)
                frames += 1
                if decode(raw)[1] in ("ping", "pong"):
                    server_pings.append(round(time.time() - t0, 1))
            print(f"still open after {time.time() - t0:.0f} s without a client ping, frames={frames}")
        except websockets.ConnectionClosed as e:
            print(f"closed by server after {time.time() - t0:.1f} s, code={e.rcvd.code if e.rcvd else None} reason={e.rcvd.reason if e.rcvd else None!r} frames={frames}")
        print(f"text ping or pong frames from the server, s after subscribe: {server_pings}")


async def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("session", "all"):
        await session()
    if mode in ("bulk", "all"):
        await bulk()
    if mode in ("silence", "all"):
        await silence()


if __name__ == "__main__":
    asyncio.run(main())
