# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""KTX public market data WebSocket probe for docs/profiles/ktx/websocket.md.

Read-only and unauthenticated.
It opens at most two sockets at a time on wss://m-stream.ktx.com and holds sockets for about three and a half minutes in total.
It sends a handful of REST book requests to api.ktx.com, far inside the published 10,000 requests per 10 seconds.
Run from the repository root with: uv run scripts/probes/venues/ktx/ws-probe.py
Passing plain as the one argument runs only the ten second check of a socket that offers no compression.
"""

import asyncio
import json
import logging
import sys
import time
import urllib.request

import websockets

WS_URL = "wss://m-stream.ktx.com"
REST = "https://api.ktx.com/api"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}

BOOK_SECONDS = 45
ALL_SYMBOLS_SECONDS = 20
SILENCE_SECONDS = 60


def rest(path: str):
    req = urllib.request.Request(REST + path, headers=UA)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def trim(frame: str, n: int = 400) -> str:
    return frame if len(frame) <= n else frame[:n] + "...(trimmed)"


class Book:
    def __init__(self) -> None:
        self.bids: dict[str, str] = {}
        self.asks: dict[str, str] = {}

    def apply(self, data: dict, snapshot: bool) -> None:
        if snapshot:
            self.bids.clear()
            self.asks.clear()
        for side, levels in ((self.bids, data.get("b", [])), (self.asks, data.get("a", []))):
            for price, size in levels:
                if float(size) == 0:
                    side.pop(price, None)
                else:
                    side[price] = size

    def top(self, n: int):
        b = sorted(self.bids.items(), key=lambda kv: -float(kv[0]))[:n]
        a = sorted(self.asks.items(), key=lambda kv: float(kv[0]))[:n]
        return b, a


def order_ok(levels, descending: bool) -> bool:
    prices = [float(p) for p, _ in levels]
    return prices == sorted(prices, reverse=descending)


async def book_run() -> None:
    section(f"book channel, lpc BTC_USDT_SWAP and ETH_USDT_SWAP at depth 20, plus spot BTC_USDT, {BOOK_SECONDS} s")
    streams = ["lpc.BTC_USDT_SWAP.order_book.20", "lpc.ETH_USDT_SWAP.order_book.20", "spot.BTC_USDT.order_book.20"]
    t0 = time.perf_counter()
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None, compression="deflate") as ws:
        print(f"handshake {1000 * (time.perf_counter() - t0):.0f} ms")
        print("server headers:", {k: v for k, v in ws.response.headers.items() if k.lower() in ("sec-websocket-extensions", "server", "cf-ray")})
        await ws.send(json.dumps({"id": 1, "method": "SUBSCRIBE", "params": streams}))
        books = {s: Book() for s in streams}
        seen = {s: 0 for s in streams}
        ids: dict[str, list[int]] = {s: [] for s in streams}
        history: dict[str, dict[int, tuple]] = {s: {} for s in streams}
        stats = {s: {"msgs": 0, "max_levels": 0, "empty_side": 0, "zero_levels": 0, "beyond_depth": 0, "crossed": 0, "unsorted": 0, "same_i": 0, "dec_i": 0, "s_later": 0} for s in streams}
        frames: dict[str, str] = {}
        rest_checks = []
        pongs = []
        next_ping = time.monotonic() + 5
        next_rest = time.monotonic() + 8
        end = time.monotonic() + BOOK_SECONDS
        while time.monotonic() < end:
            if time.monotonic() >= next_ping:
                ts = int(time.time() * 1000)
                await ws.send(json.dumps({"ping": ts}))
                pongs.append([ts, time.perf_counter(), None])
                next_ping += 8
            if time.monotonic() >= next_rest and len(rest_checks) < 6:
                next_rest += 8
                sym = "BTC_USDT_SWAP"
                r = await asyncio.to_thread(rest, f"/v1/order_book?market=lpc&symbol={sym}&level=20")
                rest_checks.append(r["result"])
            try:
                raw = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            msg = json.loads(raw)
            if "pong" in msg:
                for p in pongs:
                    if p[0] == msg["pong"] and p[2] is None:
                        p[2] = 1000 * (time.perf_counter() - p[1])
                frames.setdefault("pong", raw)
                continue
            if "result" in msg or "error" in msg:
                frames.setdefault("ack", raw)
                continue
            stream = msg.get("stream")
            if stream not in books:
                frames.setdefault("other", raw)
                continue
            data = msg["data"]
            first = seen[stream] == 0
            seen[stream] += 1
            st = stats[stream]
            st["msgs"] += 1
            i = int(data["i"])
            if ids[stream]:
                if i == ids[stream][-1]:
                    st["same_i"] += 1
                if i < ids[stream][-1]:
                    st["dec_i"] += 1
            ids[stream].append(i)
            nb, na = len(data.get("b", [])), len(data.get("a", []))
            st["max_levels"] = max(st["max_levels"], nb, na)
            if not first and (nb == 0 or na == 0):
                st["empty_side"] += 1
            st["zero_levels"] += sum(1 for _, q in data.get("b", []) + data.get("a", []) if float(q) == 0)
            if not order_ok(data.get("b", []), True) or not order_ok(data.get("a", []), False):
                st["unsorted"] += 1
            if not first and "s" in data:
                st["s_later"] += 1
            if first:
                frames.setdefault("snapshot " + stream, raw)
                print(f"{stream} first frame keys {sorted(data)}, s {data.get('s')!r}, i {data['i']} type {type(data['i']).__name__}, {nb} bids {na} asks, bids descending {order_ok(data['b'], True)}, asks ascending {order_ok(data['a'], False)}")
            elif seen[stream] == 2:
                frames.setdefault("delta " + stream, raw)
            book = books[stream]
            if not first and book.bids and book.asks:
                worst_bid = min(float(p) for p in book.bids) if len(book.bids) >= 20 else None
                worst_ask = max(float(p) for p in book.asks) if len(book.asks) >= 20 else None
                for p, _ in data.get("b", []):
                    if worst_bid is not None and float(p) < worst_bid:
                        st["beyond_depth"] += 1
                for p, _ in data.get("a", []):
                    if worst_ask is not None and float(p) > worst_ask:
                        st["beyond_depth"] += 1
            book.apply(data, first)
            b, a = book.top(20)
            if b and a and float(b[0][0]) >= float(a[0][0]):
                st["crossed"] += 1
            history[stream][i] = (b[:5], a[:5])
        section("book channel results")
        for s in streams:
            st = stats[s]
            gaps = [y - x for x, y in zip(ids[s], ids[s][1:])]
            span = (ids[s][-1] - ids[s][0]) if ids[s] else 0
            dur = BOOK_SECONDS
            print(f"{s}: {st['msgs']} frames in {dur} s, {st['msgs'] / dur:.1f} per s")
            print(f"  i first {ids[s][0] if ids[s] else None} last {ids[s][-1] if ids[s] else None}, step min {min(gaps) if gaps else None} max {max(gaps) if gaps else None}, steps of exactly 1: {sum(1 for g in gaps if g == 1)} of {len(gaps)}, repeats {st['same_i']}, decreases {st['dec_i']}")
            print(f"  max levels per side in one frame {st['max_levels']}, frames with an empty side after the first {st['empty_side']}, zero size levels {st['zero_levels']}, levels beyond the 20th held price {st['beyond_depth']}")
            print(f"  frames after the first that carry the s field: {st['s_later']}")
            print(f"  unsorted frames {st['unsorted']}, crossed top of book after a frame {st['crossed']}, book size now {len(books[s].bids)} bids {len(books[s].asks)} asks")
        a_ids = set(ids[streams[0]])
        b_ids = set(ids[streams[1]])
        c_ids = set(ids[streams[2]])
        print(f"i shared between BTC and ETH swap streams: {len(a_ids & b_ids)}, between BTC swap and BTC spot: {len(a_ids & c_ids)}")
        section("WS book against REST order_book at the same update id, lpc BTC_USDT_SWAP top 5")
        h = history[streams[0]]
        for r in rest_checks:
            ri = int(r["i"])
            ws_ids = sorted(h)
            if ri in h:
                wb, wa = h[ri]
                rb = [tuple(x) for x in r["b"][:5]]
                ra = [tuple(x) for x in r["a"][:5]]
                same = [tuple(x) for x in wb] == rb and [tuple(x) for x in wa] == ra
                print(f"REST i {ri} matches a WS i, top 5 identical: {same}")
                if not same:
                    print("  rest", rb, ra)
                    print("  ws  ", wb, wa)
            else:
                below = [x for x in ws_ids if x < ri]
                above = [x for x in ws_ids if x > ri]
                print(f"REST i {ri} not among WS ids, nearest WS below {below[-1] if below else None} above {above[0] if above else None}")
        section("heartbeat")
        for ts, _, rtt in pongs:
            print(f"sent ping {ts}, pong echoed in {rtt:.0f} ms" if rtt is not None else f"sent ping {ts}, no pong")
        section("captured frames")
        for k, v in frames.items():
            print(f"{k}: {trim(v)}")


async def errors_run() -> None:
    section("subscribe errors and variants")
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None) as ws:
        cases = [
            ("unknown symbol", ["lpc.NOPE_USDT_SWAP.order_book.20"]),
            ("inactive symbol EOS", ["lpc.EOS_USDT_SWAP.order_book.20"]),
            ("depth 7", ["lpc.BTC_USDT_SWAP.order_book.7"]),
            ("depth 1000", ["lpc.BTC_USDT_SWAP.order_book.1000"]),
            ("depth 5", ["lpc.BTC_USDT_SWAP.order_book.5"]),
            ("no depth", ["lpc.BTC_USDT_SWAP.order_book"]),
            ("lower case", ["lpc.btc_usdt_swap.order_book.5"]),
            ("unknown market", ["swap.BTC_USDT_SWAP.order_book.5"]),
            ("lpc ticker", ["lpc.BTC_USDT_SWAP.ticker"]),
            ("lpc trades", ["lpc.BTC_USDT_SWAP.trades"]),
            ("guessed mark channel", ["lpc.BTC_USDT_SWAP.mark_price"]),
            ("guessed funding channel", ["lpc.BTC_USDT_SWAP.funding_rate"]),
            ("guessed index channel", ["lpc.BTC_USDT_SWAP.index_price"]),
        ]
        for n, (label, params) in enumerate(cases, start=10):
            await ws.send(json.dumps({"id": n, "method": "SUBSCRIBE", "params": params}))
            got = []
            end = time.monotonic() + 3
            while time.monotonic() < end and len(got) < 3:
                try:
                    raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                if msg.get("stream") and msg["stream"] not in params:
                    continue
                got.append(raw)
            print(f"{label} {params}:")
            for g in got:
                print(f"  {trim(g, 300)}")
            if not got:
                print("  nothing within 3 s")
            await ws.send(json.dumps({"id": n + 100, "method": "UNSUBSCRIBE", "params": params}))
            await asyncio.sleep(0.3)
        section("unsubscribe answer and malformed request")
        await ws.send(json.dumps({"id": 900, "method": "UNSUBSCRIBE", "params": ["lpc.BTC_USDT_SWAP.order_book.5"]}))
        await ws.send("not json")
        await ws.send(json.dumps({"id": 901, "method": "HELLO", "params": []}))
        end = time.monotonic() + 3
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            if "stream" in msg:
                continue
            print(f"  {trim(raw, 300)}")


async def frame_size_trial(streams: list[str], count: int) -> None:
    params = streams[:count]
    frame = json.dumps({"id": 1, "method": "SUBSCRIBE", "params": params})
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None) as ws:
        await ws.send(frame)
        ack = None
        got: set[str] = set()
        end = time.monotonic() + 4
        while time.monotonic() < end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 1))
            except asyncio.TimeoutError:
                continue
            if "stream" in msg:
                got.add(msg["stream"])
            else:
                ack = msg.get("result") or msg
        print(f"one SUBSCRIBE frame of {len(frame)} bytes with {len(params)} streams: ack {ack!r}, streams with data {len(got)}")


async def all_symbols_run() -> None:
    cat = rest("/v1/products?market=lpc")["result"]
    active = [p["symbol"] for p in cat if p["active"] == 1]
    streams = [f"lpc.{s}.order_book.5" for s in active]
    section("streams per SUBSCRIBE frame, depth 5 streams of active perpetuals, one fresh socket each")
    for count in (100, 101, 105, 110):
        await frame_size_trial(streams, count)
    batches = [streams[i:i + 50] for i in range(0, len(streams), 50)]
    section(f"every active perpetual on one socket, {len(active)} streams at depth 5 in {len(batches)} frames of at most 50, {ALL_SYMBOLS_SECONDS} s")
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None) as ws:
        for n, b in enumerate(batches):
            await ws.send(json.dumps({"id": 100 + n, "method": "SUBSCRIBE", "params": b}))
            await asyncio.sleep(0.2)
        counts: dict[str, int] = {}
        acks = []
        empty_snap = []
        nbytes = 0
        end = time.monotonic() + ALL_SYMBOLS_SECONDS
        next_ping = time.monotonic() + 8
        while time.monotonic() < end:
            if time.monotonic() >= next_ping:
                await ws.send(json.dumps({"ping": int(time.time() * 1000)}))
                next_ping += 8
            try:
                raw = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            nbytes += len(raw)
            msg = json.loads(raw)
            if "stream" in msg:
                s = msg["stream"]
                if s not in counts:
                    d = msg["data"]
                    if not d.get("b") or not d.get("a"):
                        empty_snap.append(f"{s} {len(d.get('b', []))}b/{len(d.get('a', []))}a")
                counts[s] = counts.get(s, 0) + 1
            elif "pong" not in msg:
                acks.append(f"id {msg.get('id')} {msg.get('result')} {len(msg.get('events', []))} events")
        print(f"acks: {acks}")
        print(f"streams that sent at least one frame: {len(counts)} of {len(streams)}")
        print(f"frames {sum(counts.values())}, {sum(counts.values()) / ALL_SYMBOLS_SECONDS:.0f} per s, {nbytes / ALL_SYMBOLS_SECONDS / 1024:.0f} KiB per s decompressed")
        silent = [s for s in streams if s not in counts]
        quiet = [s for s in streams if counts.get(s, 0) == 1]
        print(f"subscribed streams with no frame: {len(silent)}, for example {silent[:5]}")
        print(f"streams with only the snapshot frame: {len(quiet)}, for example {quiet[:5]}")
        print(f"first frames with an empty side: {len(empty_snap)}, {empty_snap[:5]}")


class PingCounter(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.pings: list[float] = []

    def emit(self, record: logging.LogRecord) -> None:
        text = record.getMessage()
        if text.startswith("< PING"):
            self.pings.append(time.monotonic())


async def silence_run() -> None:
    section(f"silence: subscribe one book, send no heartbeat, wait up to {SILENCE_SECONDS} s")
    counter = PingCounter()
    log = logging.getLogger("websockets.client")
    log.setLevel(logging.DEBUG)
    log.addHandler(counter)
    log.propagate = False
    t0 = time.monotonic()
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None) as ws:
        await ws.send(json.dumps({"id": 3, "method": "SUBSCRIBE", "params": ["lpc.BTC_USDT_SWAP.order_book.5"]}))
        try:
            while time.monotonic() - t0 < SILENCE_SECONDS:
                try:
                    await asyncio.wait_for(ws.recv(), 1)
                except asyncio.TimeoutError:
                    pass
            print(f"still open after {time.monotonic() - t0:.1f} s without a client heartbeat")
            gaps = [round(b - a, 1) for a, b in zip(counter.pings, counter.pings[1:])]
            print(f"server protocol ping frames received: {len(counter.pings)}, first at {counter.pings[0] - t0:.1f} s, intervals {gaps}" if counter.pings else "server protocol ping frames received: 0")
        except websockets.ConnectionClosed as exc:
            print(f"closed after {time.monotonic() - t0:.1f} s, code {exc.rcvd.code if exc.rcvd else None} reason {exc.rcvd.reason if exc.rcvd else None!r}")


async def plain_run() -> None:
    section("socket without permessage-deflate, lpc BTC_USDT_SWAP depth 20, 10 s")
    async with websockets.connect(WS_URL, max_size=None, ping_interval=None, compression=None) as ws:
        print(f"server extensions header: {ws.response.headers.get('Sec-WebSocket-Extensions')!r}")
        await ws.send(json.dumps({"id": 1, "method": "SUBSCRIBE", "params": ["lpc.BTC_USDT_SWAP.order_book.20"]}))
        n, first = 0, None
        end = time.monotonic() + 10
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            if isinstance(raw, bytes):
                print(f"binary frame of {len(raw)} bytes")
            msg = json.loads(raw)
            if "stream" in msg:
                n += 1
                first = first or raw
        print(f"book frames {n}, all text, first {trim(first or '', 200)}")


async def main() -> None:
    if sys.argv[1:] == ["plain"]:
        await plain_run()
        return
    await plain_run()
    await book_run()
    await errors_run()
    await all_symbols_run()
    await silence_run()


if __name__ == "__main__":
    asyncio.run(main())
