# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for B2Z Exchange perpetual books, public topics only.

B2Z serves the BTSE socket protocol on ws.b2z.exchange, so the book mode holds a BTSE socket beside it.

Modes, all by default, or name some on the command line:
    book     update:BTC-PERP_0 and update:ETH-PERP_0 on the B2Z and BTSE OSS sockets for 40 s side by side:
             acknowledgement, snapshot, delta chain, level order, the seqNum values both feeds share, text ping,
             an unknown symbol, and the compression each handshake negotiated
    batch    every B2Z perpetual on update:<symbol>_0, 100 topics per socket, for 45 s: snapshots, gaps, crossed books
    main     tradeHistoryApiV3:BTC-PERP on the main futures socket, and a book topic sent to it, for 15 s
    idle     one OSS socket that offers no compression, sends no subscription and no ping, held up to 70 s, to time the idle close

Every topic is public and unauthenticated.
Total socket time is about 5 minutes, inside the survey's 10 minute budget.

Run from the repository root:
    uv run scripts/probes/venues/b2z/ws-probe.py [mode ...]
"""

import asyncio
import collections
import json
import statistics
import sys
import time
import urllib.request

import websockets

B2Z_OSS = "wss://ws.b2z.exchange/ws/oss/futures"
B2Z_MAIN = "wss://ws.b2z.exchange/ws/futures"
BTSE_OSS = "wss://ws.btse.com/ws/oss/futures"
MARKETS = "https://api.b2z.exchange/public-api/market/v1/markets?types=%5B%22FuturesPerpetual%22%5D"


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def trim(frame: dict, n: int = 2) -> dict:
    d = dict(frame.get("data") or {})
    for side in ("bids", "asks"):
        if side in d:
            d[side] = d[side][:n] + (["..."] if len(d[side]) > n else [])
    return {**frame, "data": d}


class Book:
    def __init__(self):
        self.bids, self.asks, self.last, self.gaps, self.crossed = {}, {}, None, 0, 0
        self.snapshots, self.deltas, self.max_levels = 0, 0, 0

    def apply(self, d: dict) -> None:
        if d.get("type") == "snapshot":
            self.snapshots += 1
            self.bids = {float(p): s for p, s in d["bids"]}
            self.asks = {float(p): s for p, s in d["asks"]}
        else:
            self.deltas += 1
            if self.last is not None and d.get("prevSeqNum") != self.last:
                self.gaps += 1
            for side, book in (("bids", self.bids), ("asks", self.asks)):
                for p, s in d.get(side, []):
                    if float(s) == 0:
                        book.pop(float(p), None)
                    else:
                        book[float(p)] = s
        self.last = d.get("seqNum")
        self.max_levels = max(self.max_levels, len(self.bids), len(self.asks))
        if self.bids and self.asks and max(self.bids) >= min(self.asks):
            self.crossed += 1


async def feed(name: str, url: str, topics: list[str], seconds: float, log: dict, ping_every: float = 15.0) -> None:
    t0 = time.monotonic()
    async with websockets.connect(url, open_timeout=15, ping_interval=None, max_size=None) as ws:
        out(mode="book", feed=name, opened_ms=round((time.monotonic() - t0) * 1000),
            extensions=ws.response.headers.get("Sec-WebSocket-Extensions"))
        await ws.send(json.dumps({"op": "subscribe", "args": topics}))
        sent_ping, next_ping, end = None, time.monotonic() + ping_every, time.monotonic() + seconds
        while time.monotonic() < end:
            if time.monotonic() >= next_ping:
                sent_ping = time.monotonic()
                await ws.send("ping")
                next_ping += ping_every
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            now = time.time()
            if raw == "pong":
                out(mode="book", feed=name, pong_ms=round((time.monotonic() - sent_ping) * 1000))
                continue
            frame = json.loads(raw)
            if "event" in frame or "errors" in frame:
                out(mode="book", feed=name, control=frame)
                continue
            d = frame.get("data") or {}
            sym = d.get("symbol")
            book = log["books"].setdefault((name, sym), Book())
            if d.get("type") == "snapshot" and book.snapshots == 0:
                bp = [float(p) for p, _ in d["bids"]]
                ap = [float(p) for p, _ in d["asks"]]
                out(mode="book", feed=name, snapshot=trim(frame), bids=len(bp), asks=len(ap),
                    bids_desc=bp == sorted(bp, reverse=True), asks_desc=ap == sorted(ap, reverse=True),
                    age_ms=round(now * 1000 - d.get("timestamp", 0)))
            elif d.get("type") == "delta" and book.deltas == 0:
                out(mode="book", feed=name, first_delta=trim(frame), chained=d.get("prevSeqNum") == book.last)
            book.apply(d)
            log["seq"][(name, sym)].add(d.get("seqNum"))
            log["ts"][(name, sym)][d.get("seqNum")] = now
            log["topics"][(name, sym)].add(frame.get("topic"))


async def book_mode() -> None:
    log = {"books": {}, "seq": collections.defaultdict(set), "ts": collections.defaultdict(dict),
           "topics": collections.defaultdict(set)}
    topics = ["update:BTC-PERP_0", "update:ETH-PERP_0", "update:NOPE-PERP_0"]
    await asyncio.gather(feed("b2z", B2Z_OSS, topics, 40, log), feed("btse", BTSE_OSS, topics[:2], 40, log))
    for (name, sym), b in sorted(log["books"].items()):
        out(mode="book", feed=name, symbol=sym, snapshots=b.snapshots, deltas=b.deltas, gaps=b.gaps, crossed=b.crossed,
            max_levels=b.max_levels, topics=sorted(t for t in log["topics"][(name, sym)] if t))
    for sym in ("BTC-PERP", "ETH-PERP"):
        a, b = log["seq"][("b2z", sym)], log["seq"][("btse", sym)]
        both = a & b
        lag = [log["ts"][("b2z", sym)][s] - log["ts"][("btse", sym)][s] for s in both]
        out(mode="book", symbol=sym, b2z_seq=len(a), btse_seq=len(b), shared_seq=len(both),
            b2z_minus_btse_arrival_ms_median=round(statistics.median(lag) * 1000, 1) if lag else None)


async def batch_mode() -> None:
    with urllib.request.urlopen(urllib.request.Request(MARKETS, headers={"User-Agent": "Mozilla/5.0"}), timeout=30) as r:
        syms = [m["tradeCurrency"] for m in json.loads(r.read())["data"]["symbols"]]
    chunks = [syms[i:i + 100] for i in range(0, len(syms), 100)]
    out(mode="batch", perpetuals=len(syms), sockets=len(chunks))
    log = {"books": {}, "seq": collections.defaultdict(set), "ts": collections.defaultdict(dict),
           "topics": collections.defaultdict(set)}
    await asyncio.gather(*(feed(f"b2z-{i}", B2Z_OSS, [f"update:{s}_0" for s in c], 45, log)
                           for i, c in enumerate(chunks)))
    books = list(log["books"].values())
    booked = {sym for (_, sym) in log["books"]}
    out(mode="batch", booked=len(booked), missing=sorted(set(syms) - booked), snapshots=sum(b.snapshots for b in books),
        multi_snapshot=sum(b.snapshots > 1 for b in books), deltas=sum(b.deltas for b in books),
        gaps=sum(b.gaps for b in books), crossed_topics=sum(b.crossed > 0 for b in books),
        max_levels=max(b.max_levels for b in books))


async def main_mode() -> None:
    async with websockets.connect(B2Z_MAIN, open_timeout=15, ping_interval=None) as ws:
        await ws.send(json.dumps({"op": "subscribe", "args": ["tradeHistoryApiV3:BTC-PERP", "update:BTC-PERP_0"]}))
        end, counts = time.monotonic() + 15, collections.Counter()
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            if isinstance(raw, bytes):
                counts["binary"] += 1
                continue
            frame = json.loads(raw)
            if "event" in frame:
                out(mode="main", control=frame)
            else:
                counts[frame.get("topic")] += 1
        out(mode="main", frames=dict(counts))


async def idle_mode() -> None:
    t0 = time.monotonic()
    async with websockets.connect(B2Z_OSS, open_timeout=15, ping_interval=None, compression=None) as ws:
        out(mode="idle", compression_offered=False, extensions=ws.response.headers.get("Sec-WebSocket-Extensions"))
        try:
            while time.monotonic() - t0 < 70:
                await asyncio.wait_for(ws.recv(), timeout=75 - (time.monotonic() - t0))
        except websockets.ConnectionClosed as e:
            out(mode="idle", closed_after_s=round(time.monotonic() - t0, 1), code=e.rcvd.code if e.rcvd else None,
                reason=e.rcvd.reason if e.rcvd else None)
            return
        except asyncio.TimeoutError:
            pass
    out(mode="idle", open_after_s=round(time.monotonic() - t0, 1))


MODES = {"book": book_mode, "batch": batch_mode, "main": main_mode, "idle": idle_mode}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="b2z ws", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for m in picked:
        asyncio.run(MODES[m]())
