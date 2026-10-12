# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13", "httpx>=0.27"]
# ///
"""EasiCoin WebSocket probe: the web app's public futures socket, its book topic, frame cadence, sequence, tickers, keepalive, silence and errors.

EasiCoin documents no public WebSocket, so the URL, topics and ping format are the ones the www.easicoin.io futures web app uses, found in its script bundles.
Public, unauthenticated and read-only.
Sockets open without permessage-deflate, except in the deflate mode.

Run from the repository root:
  uv run scripts/probes/venues/easicoin/ws-probe.py [book|tickers|batch|silence|deflate]
    book     ob_depth on four USDT perps for 60 s, tickers-100 fields, the error cases and an unsubscribe, about 90 s
    tickers  tickers.all for 30 s: rows per frame, fields, how often mark and index change, about 32 s
    batch    ob_depth on 100 USDT perps on one connection for 40 s, about 45 s
    silence  three sockets that differ in whether they subscribe and whether they answer the server ping, for up to 60 s
    deflate  asks for permessage-deflate once, about 6 s
Set PROBE_OUT_DIR to keep raw frames, trimmed to 2,000 characters each.
Recorded in docs/profiles/easicoin/websocket.md and rest.md.
"""

import asyncio
import collections
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone

import httpx
import websockets

URL = "wss://www.easicoin.io/realtime_public?v=2&bin=false"
CATALOG = "https://www.easicoin.io/mapi/trade/public/v1/market/dynamic_symbol"
ORIGIN = "https://www.easicoin.io"
OUT = os.environ.get("PROBE_OUT_DIR")


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, default=str), flush=True)


def capture(name, text):
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "a") as f:
            f.write(text[:2000] + "\n")


def pct(values, p):
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * p))] if s else None


async def connect(name, compression=None):
    t0 = time.perf_counter()
    try:
        ws = await websockets.connect(URL, origin=ORIGIN, compression=compression, max_size=2**25, ping_interval=None)
    except websockets.InvalidStatus as e:
        log("refused", name=name, status=e.response.status_code, body=e.response.body[:200] if e.response.body else None)
        raise
    ext = ws.response.headers.get("sec-websocket-extensions")
    log("upgrade", name=name, status=ws.response.status_code, ms=round((time.perf_counter() - t0) * 1000), extensions=ext)
    return ws


async def recv_until(ws, seconds, on_frame, answer_ping=True):
    """Reads frames for `seconds`, answers {"op":"ping"} as the web app does, and passes every other parsed frame on."""
    end = time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            raw = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            return None
        except websockets.ConnectionClosed as e:
            return e
        msg = json.loads(raw)
        if isinstance(msg, dict) and msg.get("op") == "ping":
            if answer_ping:
                await ws.send(json.dumps({"op": "pong", "args": msg.get("args")}))
            on_frame(msg, raw, ping=True)
            continue
        on_frame(msg, raw, ping=False)
    return None


def catalog_symbols():
    rows = httpx.get(CATALOG, timeout=30).json()["data"]["LinearPerpetual"]
    return rows


class BookStats:
    def __init__(self):
        self.types = collections.Counter()
        self.ts = []
        self.recv = []
        self.cs = []
        self.levels = collections.Counter()
        self.same_as_prev = 0
        self.prev = None
        self.crossed = 0
        self.bid_order = collections.Counter()
        self.ask_order = collections.Counter()
        self.first_ms = None
        self.bytes = 0

    def add(self, msg, raw, t_sub):
        now = time.monotonic()
        if self.first_ms is None:
            self.first_ms = round((now - t_sub) * 1000)
        self.bytes += len(raw)
        self.types[msg.get("type")] += 1
        self.ts.append(msg.get("ts"))
        self.recv.append(now)
        self.cs.append(msg.get("cs"))
        d = msg.get("data") or {}
        b, a = d.get("b") or [], d.get("a") or []
        self.levels[(len(b), len(a))] += 1
        key = json.dumps([b, a])
        if key == self.prev:
            self.same_as_prev += 1
        self.prev = key
        bp = [float(x[0]) for x in b]
        ap = [float(x[0]) for x in a]
        self.bid_order["ascending" if bp == sorted(bp) else "descending" if bp == sorted(bp, reverse=True) else "unordered"] += 1
        self.ask_order["ascending" if ap == sorted(ap) else "descending" if ap == sorted(ap, reverse=True) else "unordered"] += 1
        if bp and ap and max(bp) >= min(ap):
            self.crossed += 1

    def summary(self):
        ts_gaps = [(self.ts[i + 1] - self.ts[i]) / 1000 for i in range(len(self.ts) - 1) if self.ts[i] and self.ts[i + 1]]
        cs = [c for c in self.cs if c is not None]
        cs_gaps = collections.Counter(cs[i + 1] - cs[i] for i in range(len(cs) - 1))
        return {
            "frames": sum(self.types.values()),
            "types": dict(self.types),
            "levels": {f"{k[0]}x{k[1]}": v for k, v in self.levels.most_common(5)},
            "tsGapMs": {"median": statistics.median(ts_gaps) if ts_gaps else None, "p05": pct(ts_gaps, 0.05), "p95": pct(ts_gaps, 0.95), "max": max(ts_gaps) if ts_gaps else None},
            "tsGridMod100ms": dict(collections.Counter(round(t / 1000) % 100 for t in self.ts if t).most_common(3)),
            "csGaps": dict(cs_gaps.most_common(6)),
            "csBackwards": sum(1 for i in range(len(cs) - 1) if cs[i + 1] < cs[i]),
            "identicalToPrevious": self.same_as_prev,
            "crossed": self.crossed,
            "bidOrder": dict(self.bid_order),
            "askOrder": dict(self.ask_order),
            "firstFrameMs": self.first_ms,
            "bytes": self.bytes,
        }


async def book():
    rows = catalog_symbols()
    names = {r["symbolName"] for r in rows}
    stock = next((r["symbolName"] for r in rows if r.get("symbolCategory") == "stock"), None)
    quiet = rows[-1]["symbolName"]
    symbols = ["BTCUSDT", "ETHUSDT", stock, quiet]
    log("symbols", symbols=symbols, stockExample=stock, quietExample=quiet)

    ws = await connect("book")
    stats = {s: BookStats() for s in symbols}
    tick = collections.Counter()
    tick_fields = collections.Counter()
    acks = []
    pings = []
    t_sub = time.monotonic()
    topics = [f"ob_depth.{s}" for s in symbols] + ["tickers-100.BTCUSDT"]
    await ws.send(json.dumps({"op": "subscribe", "args": topics}))

    def on(msg, raw, ping):
        if ping:
            pings.append((time.monotonic(), msg))
            capture("book-ping.txt", raw)
            return
        topic = msg.get("topic")
        if topic and topic.startswith("ob_depth."):
            s = topic.split(".", 1)[1]
            if stats[s].types.total() < 3:
                capture(f"book-{s}.txt", raw)
            stats[s].add(msg, raw, t_sub)
        elif topic == "tickers-100.BTCUSDT":
            tick[msg.get("type")] += 1
            tick_fields.update((msg.get("data") or {}).keys())
            if tick.total() <= 3:
                capture("tickers-100.txt", raw)
        else:
            acks.append(msg)
            capture("book-acks.txt", raw)

    closed = await recv_until(ws, 60, on)
    log("acks", acks=acks)
    for s in symbols:
        log("ob_depth", symbol=s, **stats[s].summary())
    gaps = [round(pings[i + 1][0] - pings[i][0], 1) for i in range(len(pings) - 1)]
    log("server_pings", count=len(pings), gapsSeconds=gaps, example=pings[0][1] if pings else None)
    log("tickers_100", types=dict(tick), fields=dict(tick_fields))

    # Error cases, one subscribe frame each, on the same socket.
    cases = [
        ["ob_depth.NOPEUSDT"],
        ["books-25.BTCUSDT"],
        ["ob_snap_shot.BTCUSDT"],
        ["ob_depth.BTCUSDT"],
        ["ob_depth.BTCUSDX"],
        ["ob_depth.XAUUSD"],
        ["ob_depth.BTC_USDT"],
        ["ob_depth.btcusdt"],
        ["nope.BTCUSDT"],
        ["ob_depth.SOLUSDT", "ob_depth.NOPE2USDT"],
    ]
    for args in cases:
        await ws.send(json.dumps({"op": "subscribe", "args": args}))
        got = []
        delivered = collections.Counter()

        def on_case(msg, raw, ping):
            if ping:
                return
            if "success" in msg:
                got.append({k: msg.get(k) for k in ("success", "ret_msg")})
            elif msg.get("topic") in [f"{a}" for a in args] and msg.get("topic") != "ob_depth.BTCUSDT":
                delivered[msg["topic"]] += 1

        await recv_until(ws, 2.5, on_case)
        log("error_case", args=args, replies=got, delivered=dict(delivered))
    await ws.send(json.dumps({"op": "unsubscribe", "args": ["ob_depth.BTCUSDT"]}))
    unsub = []
    after = collections.Counter()

    def on_unsub(msg, raw, ping):
        if "success" in msg:
            unsub.append({k: msg.get(k) for k in ("success", "ret_msg", "request")})
        elif msg.get("topic"):
            after[msg["topic"]] += 1

    await recv_until(ws, 3, on_unsub)
    log("unsubscribe", replies=unsub, framesAfter=dict(after))
    await ws.close()
    log("closed", byServer=bool(closed))


async def tickers():
    ws = await connect("tickers")
    await ws.send(json.dumps({"op": "subscribe", "args": ["tickers.all"]}))
    frames = []
    fields = collections.Counter()
    meta = collections.Counter()
    last = {}
    changes = collections.Counter()
    seen = collections.Counter()

    def on(msg, raw, ping):
        if ping or msg.get("topic") != "tickers.all":
            return
        data = msg.get("data") or []
        frames.append((time.monotonic(), len(data), len(raw)))
        meta.update(k for k in msg.keys() if k not in ("topic", "data"))
        if len(frames) <= 2:
            capture("tickers-all.txt", raw)
        for r in data:
            fields.update(r.keys())
            s = r.get("s")
            seen[s] += 1
            for k in ("mp", "ip", "fr", "p"):
                if k in r and s in last and last[s].get(k) != r[k]:
                    changes[(s, k)] += 1
            last.setdefault(s, {}).update(r)

    await recv_until(ws, 30, on)
    gaps = [round(frames[i + 1][0] - frames[i][0], 2) for i in range(len(frames) - 1)]
    log("tickers_all", frames=len(frames), rowsPerFrame=dict(collections.Counter(f[1] for f in frames).most_common(5)), bytesMedian=statistics.median(f[2] for f in frames) if frames else None, gapSecondsMedian=statistics.median(gaps) if gaps else None, gapsSeconds=gaps[:40], envelopeKeys=dict(meta))
    log("tickers_all_fields", rowsSeen=fields.total(), contracts=len(seen), fields=dict(fields))
    cat = httpx.get(CATALOG, timeout=30).json()["data"]
    linear = {r["symbolName"] for r in cat["LinearPerpetual"]}
    others = {r["symbolName"]: fam for fam in ("FreeUPerpetual", "BlockTradePerpetual") for r in cat.get(fam) or []}
    extra = sorted(set(seen) - linear)
    log("tickers_all_vs_catalog", linearInFrame=len(set(seen) & linear), linearMissing=sorted(linear - set(seen)), notLinear=[[s, others.get(s, "not in catalog")] for s in extra])
    for s in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
        log("tickers_all_changes", symbol=s, rowsSeen=seen[s], markChanges=changes[(s, "mp")], indexChanges=changes[(s, "ip")], lastChanges=changes[(s, "p")], fundingField=last.get(s, {}).get("fr"), example=last.get(s))
    await ws.close()


async def batch():
    rows = catalog_symbols()
    symbols = [r["symbolName"] for r in rows[:100]]
    ws = await connect("batch")
    stats = collections.defaultdict(BookStats)
    acks = []
    t_sub = time.monotonic()
    for i in range(0, 100, 50):
        await ws.send(json.dumps({"op": "subscribe", "args": [f"ob_depth.{s}" for s in symbols[i : i + 50]]}))

    def on(msg, raw, ping):
        if ping:
            return
        topic = msg.get("topic")
        if topic and topic.startswith("ob_depth."):
            stats[topic.split(".", 1)[1]].add(msg, raw, t_sub)
        elif "success" in msg:
            acks.append({k: msg.get(k) for k in ("success", "ret_msg")})

    closed = await recv_until(ws, 40, on)
    sums = {s: st.summary() for s, st in stats.items()}
    frames = [v["frames"] for v in sums.values()]
    first = [v["firstFrameMs"] for v in sums.values()]
    medgap = [v["tsGapMs"]["median"] for v in sums.values() if v["tsGapMs"]["median"] is not None]
    maxgap = [v["tsGapMs"]["max"] for v in sums.values() if v["tsGapMs"]["max"] is not None]
    total_bytes = sum(v["bytes"] for v in sums.values())
    levels = collections.Counter()
    for v in sums.values():
        levels.update(v["levels"])
    types = collections.Counter()
    for v in sums.values():
        types.update(v["types"])
    log(
        "batch",
        acks=acks,
        topicsDelivering=len(sums),
        framesTotal=sum(frames),
        framesPerTopic={"min": min(frames), "median": statistics.median(frames), "max": max(frames)},
        firstFrameMs={"min": min(first), "median": statistics.median(first), "max": max(first)},
        medianTsGapMs={"min": min(medgap), "median": statistics.median(medgap), "max": max(medgap)},
        maxTsGapMs={"median": statistics.median(maxgap), "max": max(maxgap)},
        bytesPerSecond=round(total_bytes / 40),
        types=dict(types),
        levels=dict(levels.most_common(6)),
        identicalToPrevious=sum(v["identicalToPrevious"] for v in sums.values()),
        crossed=sum(v["crossed"] for v in sums.values()),
        csBackwards=sum(v["csBackwards"] for v in sums.values()),
        topicsAt100ms=sorted(s for s, v in sums.items() if (v["tsGapMs"]["median"] or 1000) < 200),
        closedByServer=bool(closed),
    )
    quiet = sorted(sums.items(), key=lambda kv: kv[1]["frames"])[:3]
    log("batch_quietest", rows=[[s, v["frames"], v["tsGapMs"], v["identicalToPrevious"]] for s, v in quiet])
    await ws.close()


async def silence():
    async def one(name, subscribe, answer):
        ws = await connect(name)
        t0 = time.monotonic()
        if subscribe:
            await ws.send(json.dumps({"op": "subscribe", "args": ["ob_depth.BTCUSDT"]}))
        pings = []
        frames = [0]

        def on(msg, raw, ping):
            if ping:
                pings.append(round(time.monotonic() - t0, 1))
            else:
                frames[0] += 1

        closed = await recv_until(ws, 60, on, answer_ping=answer)
        log("silence", name=name, subscribe=subscribe, answerPing=answer, pingsAtSeconds=pings, frames=frames[0], closedAfterSeconds=round(time.monotonic() - t0, 1) if closed else None, closeCode=getattr(closed, "code", None), closeReason=getattr(closed, "reason", None))
        if not closed:
            await ws.close()

    await asyncio.gather(one("idle_answer", False, True), one("idle_mute", False, False), one("sub_mute", True, False))


async def deflate():
    ws = await connect("deflate", compression="deflate")
    await ws.send(json.dumps({"op": "subscribe", "args": ["ob_depth.BTCUSDT"]}))
    n = [0]

    def on(msg, raw, ping):
        n[0] += 1

    await recv_until(ws, 5, on)
    log("deflate", frames=n[0])
    await ws.close()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "book"
    run = {"book": book, "tickers": tickers, "batch": batch, "silence": silence, "deflate": deflate}.get(mode)
    if not run:
        sys.exit(f"unknown mode {mode}")
    log("start", mode=mode, at=datetime.now(timezone.utc).isoformat())
    asyncio.run(run())
    log("end", mode=mode, at=datetime.now(timezone.utc).isoformat())


if __name__ == "__main__":
    main()
