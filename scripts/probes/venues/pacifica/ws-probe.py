# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Pacifica public WebSocket probe for docs/profiles/pacifica/websocket.md.

Read-only and unauthenticated, with no wallet, no signature, no account channel and no order.
It connects to wss://ws.pacifica.fi/ws, which publishes at most 100 connections per IP and 20 subscriptions per channel per connection.
Every socket refuses permessage-deflate, as the engine's feed does, except the one the deflate mode opens to test it.
Run from the repository root with: uv run scripts/probes/venues/pacifica/ws-probe.py <mode> [<mode> ...]
Modes and their socket time: book 60 s, errors about 60 s, silence 75 s on two sockets, deflate 5 s, batch 60 s on four sockets.
The REST catalog is read once per run to pick the symbols.
The errors mode opens one socket with 25 book streams, past the published 20, to test that cap once.
"""

import asyncio
import json
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict

import websockets

WS_URL = "wss://ws.pacifica.fi/ws"
REST = "https://api.pacifica.fi/api/v1"
UA = "arbitrage-observatory-probe/1.0"
BOOK_SECONDS = 60
BATCH_SECONDS = 60
SILENCE_SECONDS = 75
PER_CONNECTION = 20


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def now_ms() -> int:
    return int(time.time() * 1000)


def trim(s: str, n: int = 500) -> str:
    return s if len(s) <= n else s[:n] + "...(trimmed)"


def pct(values: list[float], q: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(q * (len(s) - 1) + 0.5))]


def summary(values: list[float]) -> str:
    if not values:
        return "none"
    return f"min {min(values):.0f}, p10 {pct(values, 0.1):.0f}, p50 {statistics.median(values):.0f}, p90 {pct(values, 0.9):.0f}, max {max(values):.0f} (n={len(values)})"


def catalog() -> list[dict]:
    req = urllib.request.Request(REST + "/info", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read())["data"]


def connect(compression=None):
    return websockets.connect(WS_URL, compression=compression, user_agent_header=UA, open_timeout=15,
                              ping_interval=None, max_size=2**24)


def sub(source: str, **params) -> str:
    return json.dumps({"method": "subscribe", "params": {"source": source, **params}})


class BookStats:
    def __init__(self) -> None:
        self.frames = defaultdict(list)  # symbol: [(arrival, t, li, nb, na, bids, asks, raw_len)]

    def add(self, arrival: int, data: dict, raw_len: int) -> None:
        bids, asks = data["l"][0], data["l"][1]
        self.frames[data["s"]].append((arrival, data.get("t"), data.get("li"), len(bids), len(asks),
                                       [(x["p"], x["a"], x["n"]) for x in bids],
                                       [(x["p"], x["a"], x["n"]) for x in asks], raw_len))

    def report(self, label: str) -> None:
        total = sum(len(v) for v in self.frames.values())
        print(f"  {label}: {total} book frames on {len(self.frames)} symbols")
        intervals, ages, li_steps, sizes = [], [], [], []
        level_counts = Counter()
        li_back = li_same = repeats = crossed = unordered = empty_side = t_back = 0
        for sym, fr in self.frames.items():
            for a, b in zip(fr, fr[1:]):
                intervals.append(b[0] - a[0])
                if a[2] is not None and b[2] is not None:
                    d = b[2] - a[2]
                    li_steps.append(d)
                    if d < 0:
                        li_back += 1
                    elif d == 0:
                        li_same += 1
                if a[1] is not None and b[1] is not None and b[1] < a[1]:
                    t_back += 1
                if a[5] == b[5] and a[6] == b[6]:
                    repeats += 1
            for f in fr:
                ages.append(f[0] - f[1])
                level_counts[(f[3], f[4])] += 1
                sizes.append(f[7])
                bp = [float(x[0]) for x in f[5]]
                ap = [float(x[0]) for x in f[6]]
                if bp != sorted(bp, reverse=True) or ap != sorted(ap):
                    unordered += 1
                if bp and ap and bp[0] >= ap[0]:
                    crossed += 1
                if not bp or not ap:
                    empty_side += 1
        print(f"  levels per side (bids, asks): {dict(level_counts.most_common(8))}")
        print(f"  interval between frames of one symbol ms: {summary(intervals)}")
        print(f"  arrival minus t ms: {summary(ages)}")
        print(f"  frame bytes: {summary(sizes)}")
        print(f"  li step between frames of one symbol: {summary(li_steps)}; li backwards {li_back}, li unchanged {li_same}, t backwards {t_back}")
        print(f"  frames repeating the previous book exactly: {repeats}; crossed {crossed}; out of order {unordered}; with an empty side {empty_side}")
        rate = Counter()
        for sym, fr in self.frames.items():
            dur = (fr[-1][0] - fr[0][0]) / 1000 if len(fr) > 1 else 0
            rate[sym] = round((len(fr) - 1) / dur, 2) if dur else 0
        print(f"  frames a second per symbol: {summary(list(rate.values()))}")
        quiet = sorted(rate.items(), key=lambda x: x[1])[:5]
        print(f"  five quietest symbols, frames a second: {quiet}")


async def mode_book(symbols: list[str]) -> None:
    section(f"book: one socket, book on {symbols}, bbo on BTC and ETH, prices, trades on BTC, {BOOK_SECONDS} s")
    stats = BookStats()
    bbo = defaultdict(list)
    prices = []
    acks = []
    other = Counter()
    samples = {}
    t_open = time.perf_counter()
    async with connect() as ws:
        print(f"  open in {(time.perf_counter() - t_open) * 1000:.0f} ms, response headers: server {ws.response.headers.get('server')}, via {ws.response.headers.get('via')}, x-amz-cf-pop {ws.response.headers.get('x-amz-cf-pop')}, extensions {ws.response.headers.get('sec-websocket-extensions')}")
        sent_at = now_ms()
        for s in symbols:
            await ws.send(sub("book", symbol=s, agg_level=1))
        await ws.send(sub("bbo", symbol="BTC"))
        await ws.send(sub("bbo", symbol="ETH"))
        await ws.send(sub("prices"))
        await ws.send(sub("trades", symbol="BTC"))
        first_book = {}
        end = time.time() + BOOK_SECONDS
        ping_sent = None
        while time.time() < end:
            if ping_sent is None and time.time() > end - BOOK_SECONDS / 2:
                ping_sent = time.perf_counter()
                await ws.send(json.dumps({"method": "ping"}))
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            arrival = now_ms()
            msg = json.loads(raw)
            ch = msg.get("channel")
            if ch not in samples:
                samples[ch] = trim(raw if isinstance(raw, str) else raw.decode(), 700)
            if ch == "book" and "book_cut" not in samples and msg["data"]["s"] == "BTC":
                cut = {"channel": "book", "data": dict(msg["data"])}
                cut["data"]["l"] = [msg["data"]["l"][0][:3], msg["data"]["l"][1][:3]]
                samples["book_cut"] = json.dumps(cut, separators=(",", ":"))
            if ch == "prices" and "prices_cut" not in samples:
                samples["prices_cut"] = json.dumps({"channel": "prices", "data": [r for r in msg["data"] if r["symbol"] in ("BTC", "kPEPE")]}, separators=(",", ":"))
            if ch == "book":
                d = msg["data"]
                stats.add(arrival, d, len(raw))
                first_book.setdefault(d["s"], arrival - sent_at)
            elif ch == "bbo":
                bbo[msg["data"]["s"]].append((arrival, msg["data"]))
            elif ch == "prices":
                prices.append((arrival, msg["data"], len(raw)))
            elif ch == "subscribe":
                acks.append((arrival - sent_at, raw))
            elif ch == "pong":
                print(f"  pong after {(time.perf_counter() - ping_sent) * 1000:.0f} ms: {raw}")
            else:
                other[ch] += 1
    print(f"  acknowledgements: {len(acks)}, first after {acks[0][0] if acks else None} ms, last after {acks[-1][0] if acks else None} ms")
    for a in acks[:2]:
        print(f"    {a[1]}")
    print(f"  first book frame per symbol, ms after the first subscribe: {first_book}")
    print(f"  other channels: {dict(other)}")
    stats.report("book")
    for sym, fr in stats.frames.items():
        iv = [b[0] - a[0] for a, b in zip(fr, fr[1:])]
        tv = [b[1] - a[1] for a, b in zip(fr, fr[1:])]
        rep = sum(1 for a, b in zip(fr, fr[1:]) if a[5] == b[5] and a[6] == b[6])
        print(f"  {sym}: {len(fr)} frames, interval ms p50 {statistics.median(iv) if iv else None}, t step ms p50 {statistics.median(tv) if tv else None} min {min(tv) if tv else None}, repeats {rep}, li first {fr[0][2]} last {fr[-1][2]}, levels {fr[0][3]} and {fr[0][4]}")
    for sym, fr in bbo.items():
        iv = [b[0] - a[0] for a, b in zip(fr, fr[1:])]
        ages = [a - d["t"] for a, d in fr]
        lis = [d.get("li") for _, d in fr]
        back = sum(1 for x, y in zip(lis, lis[1:]) if x is not None and y is not None and y < x)
        same_top = sum(1 for (_, x), (_, y) in zip(fr, fr[1:]) if (x["b"], x["a"], x["B"], x["A"]) == (y["b"], y["a"], y["B"], y["A"]))
        print(f"  bbo {sym}: {len(fr)} frames, {len(fr) / BOOK_SECONDS:.1f} a second, interval ms {summary(iv)}, age ms {summary(ages)}, li backwards {back}, frames repeating the previous touch {same_top}")
    btc_book = stats.frames.get("BTC", [])
    if btc_book and bbo.get("BTC"):
        agree = 0
        checked = 0
        for f in btc_book:
            before = [d for a, d in bbo["BTC"] if a <= f[0]]
            if not before:
                continue
            last = before[-1]
            checked += 1
            if f[5] and f[6] and f[5][0][0] == last["b"] and f[6][0][0] == last["a"]:
                agree += 1
        li_rel = sum(1 for f in btc_book if any(d.get("li") == f[2] for _, d in bbo["BTC"]))
        print(f"  BTC book top equal to the latest bbo received before it: {agree} of {checked}; book li also seen on a bbo frame: {li_rel} of {len(btc_book)}")
    if prices:
        iv = [b[0] - a[0] for a, b in zip(prices, prices[1:])]
        rows = [len(p[1]) for p in prices]
        ages = [p[0] - r["timestamp"] for p in prices for r in p[1]]
        tsets = Counter(len({r["timestamp"] for r in p[1]}) for p in prices)
        print(f"  prices: {len(prices)} frames, interval ms {summary(iv)}, rows per frame {dict(Counter(rows))}, distinct timestamps per frame {dict(tsets)}, age ms {summary(ages)}, bytes {summary([p[2] for p in prices])}")
        btc = [(p[0], r) for p in prices for r in p[1] if r["symbol"] == "BTC"]
        steps = [b[1]["timestamp"] - a[1]["timestamp"] for a, b in zip(btc, btc[1:])]
        print(f"  prices BTC timestamp steps ms: {summary(steps)}")
    for ch, s in samples.items():
        print(f"  sample {ch}: {s}")


async def recv_for(ws, seconds: float) -> list[tuple[int, str]]:
    got = []
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time()))
            got.append((now_ms(), raw if isinstance(raw, str) else raw.decode()))
        except asyncio.TimeoutError:
            break
    return got


async def error_case(name: str, frames: list[str], wait: float = 3.0) -> None:
    async with connect() as ws:
        t0 = now_ms()
        for f in frames:
            await ws.send(f)
        try:
            got = await recv_for(ws, wait)
            closed = None
        except websockets.ConnectionClosed as e:
            got = []
            closed = f"closed code {e.code} reason {e.reason!r} after {now_ms() - t0} ms"
        chans = Counter(json.loads(r).get("channel") for _, r in got if r.startswith("{"))
        non_data = [r for _, r in got if json.loads(r).get("channel") not in ("book", "bbo", "prices", "trades")]
        print(f"  {name}: {len(got)} frames {dict(chans)}; {closed or 'socket still open'}")
        for r in non_data[:4]:
            print(f"    {trim(r, 400)}")


async def mode_errors(perps: list[str]) -> None:
    section("errors: one socket per case")
    await error_case("book on NOPE", [sub("book", symbol="NOPE", agg_level=1)])
    await error_case("book on btc, lower case", [sub("book", symbol="btc", agg_level=1)])
    await error_case("book on BTC with agg_level 7", [sub("book", symbol="BTC", agg_level=7)], 2.0)
    await error_case("book on BTC with no agg_level", [sub("book", symbol="BTC")], 2.0)
    await error_case("bbo on NOPE", [sub("bbo", symbol="NOPE")])
    await error_case("unknown source", [sub("nope", symbol="BTC")])
    await error_case("text that is not JSON", ["hello"])
    await error_case("unknown method", [json.dumps({"method": "nope", "params": {"source": "book", "symbol": "BTC"}})])
    await error_case("book on BTC twice", [sub("book", symbol="BTC", agg_level=1), sub("book", symbol="BTC", agg_level=1)], 2.0)
    await error_case("unsubscribe never subscribed", [json.dumps({"method": "unsubscribe", "params": {"source": "book", "symbol": "ETH", "agg_level": 1}})])
    await error_case("book on SOL-USDC, the spot market", [sub("book", symbol="SOL-USDC", agg_level=1)], 2.0)
    await error_case("book on NOPE then BTC on one socket", [sub("book", symbol="NOPE", agg_level=1), sub("book", symbol="BTC", agg_level=1)], 2.0)
    syms = perps[:25]
    section(f"errors: 25 book subscriptions on one socket, past the published 20 per channel")
    async with connect() as ws:
        for s in syms:
            await ws.send(sub("book", symbol=s, agg_level=1))
        got = await recv_for(ws, 6.0)
    acks = [json.loads(r) for _, r in got if json.loads(r).get("channel") == "subscribe"]
    books = Counter(json.loads(r)["data"]["s"] for _, r in got if json.loads(r).get("channel") == "book")
    errs = [r for _, r in got if json.loads(r).get("channel") not in ("book", "subscribe")]
    print(f"  acknowledged {len(acks)}, symbols that sent a book {len(books)} of 25, silent {[s for s in syms if s not in books]}")
    for r in errs[:5]:
        print(f"    {trim(r, 400)}")
    section("errors: 20 book and 20 bbo subscriptions on one socket")
    async with connect() as ws:
        for s in syms[:20]:
            await ws.send(sub("book", symbol=s, agg_level=1))
            await ws.send(sub("bbo", symbol=s))
        got = await recv_for(ws, 5.0)
    chans = Counter(json.loads(r).get("channel") for _, r in got)
    books = {json.loads(r)["data"]["s"] for _, r in got if json.loads(r).get("channel") == "book"}
    bbos = {json.loads(r)["data"]["s"] for _, r in got if json.loads(r).get("channel") == "bbo"}
    print(f"  channels {dict(chans)}, book symbols {len(books)}, bbo symbols {len(bbos)}")


async def mode_silence() -> None:
    section(f"silence: socket A sends nothing, socket B pings every 30 s, both subscribe nothing, {SILENCE_SECONDS} s")

    async def quiet() -> None:
        t0 = time.perf_counter()
        async with connect() as ws:
            try:
                while time.perf_counter() - t0 < SILENCE_SECONDS:
                    raw = await asyncio.wait_for(ws.recv(), timeout=SILENCE_SECONDS - (time.perf_counter() - t0))
                    print(f"  A got at {time.perf_counter() - t0:.1f} s: {trim(str(raw), 200)}")
                print(f"  A still open at {time.perf_counter() - t0:.1f} s")
            except asyncio.TimeoutError:
                print(f"  A still open at {time.perf_counter() - t0:.1f} s")
            except websockets.ConnectionClosed as e:
                print(f"  A closed at {time.perf_counter() - t0:.1f} s, code {e.code}, reason {e.reason!r}, rcvd {e.rcvd}")

    async def pinger() -> None:
        t0 = time.perf_counter()
        async with connect() as ws:
            next_ping = 30.0
            try:
                while time.perf_counter() - t0 < SILENCE_SECONDS:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                        print(f"  B got at {time.perf_counter() - t0:.1f} s: {trim(str(raw), 200)}")
                    except asyncio.TimeoutError:
                        pass
                    if time.perf_counter() - t0 >= next_ping:
                        await ws.send(json.dumps({"method": "ping"}))
                        next_ping += 30.0
                print(f"  B still open at {time.perf_counter() - t0:.1f} s")
            except websockets.ConnectionClosed as e:
                print(f"  B closed at {time.perf_counter() - t0:.1f} s, code {e.code}, reason {e.reason!r}")

    await asyncio.gather(quiet(), pinger())


async def mode_deflate() -> None:
    section("deflate: a client that offers permessage-deflate")
    async with connect(compression="deflate") as ws:
        print(f"  request offered: {ws.request.headers.get('sec-websocket-extensions')}")
        print(f"  response extensions: {ws.response.headers.get('sec-websocket-extensions')}")
        await ws.send(sub("book", symbol="BTC", agg_level=1))
        got = await recv_for(ws, 2.0)
        print(f"  frames {len(got)}, first {trim(got[0][1], 150) if got else None}")
    async with connect() as ws:
        print(f"  without the offer, response extensions: {ws.response.headers.get('sec-websocket-extensions')}")


async def mode_batch(perps: list[str]) -> None:
    groups = [perps[i:i + PER_CONNECTION] for i in range(0, len(perps), PER_CONNECTION)]
    section(f"batch: book at agg_level 1 on all {len(perps)} perpetuals, {len(groups)} sockets of at most {PER_CONNECTION}, {BATCH_SECONDS} s")
    stats = BookStats()
    counts = Counter()
    bytes_total = 0
    parse_ns = 0
    frames_total = 0
    cpu0 = time.process_time()

    async def run(group: list[str], idx: int) -> None:
        nonlocal bytes_total, parse_ns, frames_total
        t_open = time.time()
        async with connect() as ws:
            for s in group:
                await ws.send(sub("book", symbol=s, agg_level=1))
            end = time.time() + BATCH_SECONDS
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed as e:
                    print(f"  socket {idx} closed by the server after {time.time() - t_open:.1f} s at {time.strftime('%H:%M:%SZ', time.gmtime())}: code {e.rcvd.code if e.rcvd else None}, reason {e.rcvd.reason if e.rcvd else None!r}")
                    return
                arrival = now_ms()
                t = time.perf_counter_ns()
                msg = json.loads(raw)
                parse_ns += time.perf_counter_ns() - t
                frames_total += 1
                bytes_total += len(raw)
                ch = msg.get("channel")
                counts[ch] += 1
                if ch == "book":
                    stats.add(arrival, msg["data"], len(raw))
                elif ch != "subscribe":
                    print(f"  socket {idx}: {trim(raw, 300)}")

    await asyncio.gather(*(run(g, i) for i, g in enumerate(groups)))
    cpu = time.process_time() - cpu0
    print(f"  channels {dict(counts)}, {frames_total / BATCH_SECONDS:.1f} frames a second, {bytes_total / BATCH_SECONDS / 1024:.1f} KiB a second, json.loads {parse_ns / max(1, frames_total) / 1000:.1f} us a frame, process CPU {cpu:.2f} s")
    print(f"  symbols that sent no book: {[s for s in perps if s not in stats.frames]}")
    stats.report("batch")


def main() -> None:
    wanted = sys.argv[1:] or ["book"]
    print("probe start", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "modes", wanted, "websockets", websockets.__version__, flush=True)
    cat = catalog()
    perps = [r["symbol"] for r in cat if r.get("instrument_type") == "perpetual"]
    print(f"  catalog: {len(perps)} perpetuals")
    import socket
    try:
        name, aliases, addrs = socket.gethostbyname_ex("ws.pacifica.fi")
        print(f"  ws.pacifica.fi resolves to {sorted(addrs)}, canonical {name}")
    except OSError as e:
        print(f"  ws.pacifica.fi lookup failed: {e}")
    for m in wanted:
        if m == "book":
            asyncio.run(mode_book(["BTC", "ETH", "SOL", "kPEPE", "XAU", "BP"]))
        elif m == "errors":
            asyncio.run(mode_errors(perps))
        elif m == "silence":
            asyncio.run(mode_silence())
        elif m == "deflate":
            asyncio.run(mode_deflate())
        elif m == "batch":
            asyncio.run(mode_batch(perps))
    print("\nprobe end", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), flush=True)


if __name__ == "__main__":
    main()
