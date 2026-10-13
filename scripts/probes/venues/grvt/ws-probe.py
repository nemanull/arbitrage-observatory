# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9", "httpx>=0.27"]
# ///
"""Read-only WebSocket probe for GRVT perpetuals, public market data only.

Every socket goes to wss://market-data.grvt.io/ws/full, the JSON-RPC full feed that CCXT Pro uses.
No socket offers permessage-deflate except in the deflate mode, as the engine's runtime never offers it.
Server pings are answered by hand and counted, and the probe sends no ping of its own unless a mode says so.

Modes, all by default, or name some on the command line:
    book     40 s of v1.book.d at 100 ms on BTC, ETH and the thinnest perpetual, v1.book.d at 50 ms on SOL,
             and v1.book.s at 500 ms and 50 levels on BTC, checking the snapshot, the sequence rule,
             level order, crossed books, and the top 20 levels of the BTC delta book against each 50-level snapshot
    ticker   40 s of v1.ticker.d at 100 ms on BTC and the thinnest perpetual, v1.ticker.s at 500 ms on ETH,
             and v1.mini.d raw on BTC, counting which fields each frame carries and how often mark, index and funding move
    errors   an unknown instrument, a delisted one, an unknown stream, a bad rate, a bad depth, a selector without a rate,
             a lowercase instrument, a JSON-RPC ticker call, an unknown method, then one valid subscribe and an unsubscribe
    batch    60 s of v1.book.d at 100 ms and v1.ticker.d at 500 ms on 50 perpetuals, 100 streams on one socket,
             two thirds of the 150 concurrent streams the help center publishes
    silence  100 s of three sockets that send no frame of their own: one holds v1.ticker.s at 5,000 ms on the
             thinnest perpetual and answers server pings, one holds nothing and answers them,
             and one holds the same ticker and leaves every server ping unanswered
    deflate  one handshake that offers permessage-deflate and one that does not, with the upgrade headers

The socket time of a full run is about 4.5 minutes.

Run from the repository root:
    uv run scripts/probes/venues/grvt/ws-probe.py [mode ...]
"""

import asyncio
import bisect
import json
import statistics
import sys
import time
from collections import Counter, defaultdict

import aiohttp
import httpx

URL = "wss://market-data.grvt.io/ws/full"
REST = "https://market-data.grvt.io/full/v1"


def out(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, separators=(",", ":"), default=str), flush=True)


def trim(frame, levels=2):
    f = json.loads(json.dumps(frame))
    feed = f.get("feed")
    if isinstance(feed, dict):
        for side in ("bids", "asks"):
            if isinstance(feed.get(side), list) and len(feed[side]) > levels:
                feed[side] = feed[side][:levels] + [f"... {len(frame['feed'][side]) - levels} more"]
    return f


def active_perps():
    r = httpx.post(f"{REST}/all_instruments", json={"is_active": True}, timeout=10)
    perps = [x for x in r.json()["result"] if x["kind"] == "PERPETUAL"]
    return perps


def thinnest(perps):
    best, best_vol = None, None
    for x in perps:
        if x.get("asset_class") != "CRYPTO":
            continue
        t = httpx.post(f"{REST}/ticker", json={"instrument": x["instrument"]}, timeout=10).json()["result"]
        vol = float(t.get("buy_volume_24h_q") or 0) + float(t.get("sell_volume_24h_q") or 0)
        if best_vol is None or vol < best_vol:
            best, best_vol = x["instrument"], vol
        time.sleep(0.1)
    return best, best_vol


async def connect(session, compress=0):
    ws = await session.ws_connect(URL, autoping=False, autoclose=False, compress=compress, heartbeat=None, max_msg_size=0)
    return ws


def subscribe(stream, selectors, rid):
    return {"jsonrpc": "2.0", "method": "subscribe", "params": {"stream": stream, "selectors": selectors}, "id": rid}


async def read_for(ws, seconds, on_frame, answer_pings=True):
    """Reads frames until the deadline, answering server pings unless told not to, and returns what ended the read."""
    deadline = time.monotonic() + seconds
    ping_times = []

    def result(ended, **extra):
        gaps = [round(b - a, 2) for a, b in zip(ping_times, ping_times[1:])]
        return {"ended": ended, "server_pings": len(ping_times), "ping_gap_s": sorted(set(gaps))[:6], **extra}

    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            return result("deadline")
        try:
            msg = await asyncio.wait_for(ws.receive(), timeout=left)
        except asyncio.TimeoutError:
            return result("deadline")
        recv_ns = time.time_ns()
        if msg.type == aiohttp.WSMsgType.TEXT:
            on_frame(json.loads(msg.data), recv_ns, len(msg.data))
        elif msg.type == aiohttp.WSMsgType.BINARY:
            out("binary_frame", bytes=len(msg.data))
        elif msg.type == aiohttp.WSMsgType.PING:
            ping_times.append(time.monotonic())
            if answer_pings:
                await ws.pong(msg.data)
            if len(ping_times) == 1:
                out("server_ping", utc=time.strftime("%H:%M:%S", time.gmtime()), payload=msg.data.hex(), answered=answer_pings)
        elif msg.type == aiohttp.WSMsgType.PONG:
            out("pong", utc=time.strftime("%H:%M:%S", time.gmtime()))
        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED):
            return result(str(msg.type), close_code=ws.close_code, extra=str(msg.extra),
                          after_s=round(seconds - (deadline - time.monotonic()), 1))
        elif msg.type == aiohttp.WSMsgType.ERROR:
            return result("error", error=str(ws.exception()), after_s=round(seconds - (deadline - time.monotonic()), 1))


class Book:
    def __init__(self):
        self.bids, self.asks = {}, {}

    def reset(self, feed):
        self.bids = {x["price"]: x["size"] for x in feed.get("bids", [])}
        self.asks = {x["price"]: x["size"] for x in feed.get("asks", [])}

    def apply(self, feed):
        zero = 0
        for side, levels in (("bids", feed.get("bids", [])), ("asks", feed.get("asks", []))):
            book = getattr(self, side)
            for x in levels:
                if float(x["size"]) == 0:
                    zero += 1
                    book.pop(x["price"], None)
                else:
                    book[x["price"]] = x["size"]
        return zero

    def top(self, n):
        b = sorted(self.bids.items(), key=lambda kv: -float(kv[0]))[:n]
        a = sorted(self.asks.items(), key=lambda kv: float(kv[0]))[:n]
        return b, a

    def crossed(self):
        if not self.bids or not self.asks:
            return False
        return max(map(float, self.bids)) >= min(map(float, self.asks))


class SelectorStats:
    def __init__(self):
        self.frames = 0
        self.bytes = 0
        self.snapshots = 0
        self.gaps = []
        self.dupes = 0
        self.prev_mismatch = 0
        self.last_seq = None
        self.first_delta_seq = None
        self.recv = []
        self.ages = []
        self.event_steps = []
        self.last_event = None
        self.levels_per_frame = []
        self.empty_deltas = 0
        self.zero_levels = 0
        self.crossed = 0
        self.snapshot_levels = None
        self.order_ok = True
        self.fields = Counter()

    def seq(self, frame):
        seq = int(frame.get("sequence_number", -1))
        prev = int(frame.get("prev_sequence_number", -1))
        if seq == 0:
            self.snapshots += 1
        else:
            if self.first_delta_seq is None:
                self.first_delta_seq = seq
            if self.last_seq is not None and self.last_seq != 0:
                if seq == self.last_seq:
                    self.dupes += 1
                elif seq != self.last_seq + 1:
                    self.gaps.append((self.last_seq, seq))
                if prev != self.last_seq:
                    self.prev_mismatch += 1
        self.last_seq = seq
        return seq

    def summary(self):
        steps = sorted(self.event_steps)
        return {
            "frames": self.frames, "bytes": self.bytes, "snapshots": self.snapshots,
            "first_delta_seq": self.first_delta_seq, "last_seq": self.last_seq,
            "gaps": self.gaps[:5], "gap_count": len(self.gaps), "dupes": self.dupes, "prev_mismatch": self.prev_mismatch,
            "event_step_ms": {"min": round(steps[0], 1), "p50": round(statistics.median(steps), 1), "max": round(steps[-1], 1)} if steps else None,
            "age_ms": {"min": round(min(self.ages), 1), "p50": round(statistics.median(self.ages), 1), "max": round(max(self.ages), 1)} if self.ages else None,
            "levels_per_delta_p50": statistics.median(self.levels_per_frame) if self.levels_per_frame else None,
            "empty_deltas": self.empty_deltas, "zero_levels": self.zero_levels, "crossed_after_frame": self.crossed,
            "snapshot_levels": self.snapshot_levels, "level_order_ok": self.order_ok, "fields": dict(self.fields),
        }


def level_order_ok(feed):
    bp = [float(x["price"]) for x in feed.get("bids", [])]
    ap = [float(x["price"]) for x in feed.get("asks", [])]
    return bp == sorted(bp, reverse=True) and ap == sorted(ap)


async def mode_book(session, perps, thin):
    ws = await connect(session)
    d_sel = ["BTC_USDT_Perp@100", "ETH_USDT_Perp@100", f"{thin}@100"]
    await ws.send_json(subscribe("v1.book.d", d_sel, 1))
    await ws.send_json(subscribe("v1.book.d", ["SOL_USDT_Perp@50"], 2))
    await ws.send_json(subscribe("v1.book.s", ["BTC_USDT_Perp@500-50"], 3))
    stats = defaultdict(SelectorStats)
    books = defaultdict(Book)
    delta_states = []  # (event_time, top 20) of the BTC delta book after each frame
    snapshots_s = []  # (event_time, top 20) of each BTC 50-level snapshot frame
    compare = Counter()
    shown = Counter()
    first_seen = {}
    t0 = time.time_ns()

    def on_frame(frame, recv_ns, size):
        if "result" in frame or "error" in frame:
            out("ack", frame=frame)
            return
        key = f"{frame['stream']}|{frame['selector']}"
        st = stats[key]
        st.frames += 1
        st.bytes += size
        feed = frame["feed"]
        seq = st.seq(frame)
        ev = int(feed["event_time"])
        st.ages.append((recv_ns - ev) / 1e6)
        if st.last_event is not None:
            st.event_steps.append((ev - st.last_event) / 1e6)
        st.last_event = ev
        if key not in first_seen:
            first_seen[key] = round((recv_ns - t0) / 1e6)
        if shown[key] < 2:
            shown[key] += 1
            out("frame", key=key, recv_ms_after_open=round((recv_ns - t0) / 1e6), frame=trim(frame))
        book = books[key]
        if frame["stream"] == "v1.book.s" or seq == 0:
            st.snapshot_levels = [len(feed.get("bids", [])), len(feed.get("asks", []))]
            st.order_ok = st.order_ok and level_order_ok(feed)
            book.reset(feed)
            if frame["stream"] == "v1.book.s":
                snapshots_s.append((ev, book.top(20)))
        else:
            n = len(feed.get("bids", [])) + len(feed.get("asks", []))
            st.levels_per_frame.append(n)
            if n == 0:
                st.empty_deltas += 1
            st.zero_levels += book.apply(feed)
        if book.crossed():
            st.crossed += 1
        if key == "v1.book.d|BTC_USDT_Perp@100":
            delta_states.append((ev, book.top(20)))

    end = await read_for(ws, 40, on_frame)
    out("book_end", **end)
    for key, st in stats.items():
        out("selector_summary", key=key, first_frame_ms=first_seen.get(key), **st.summary())
    # each 50-level snapshot of BTC against the delta book just before and just after its event_time, top 20 levels
    times = [t for t, _ in delta_states]
    for ev, top in snapshots_s:
        i = bisect.bisect_right(times, ev)
        before = delta_states[i - 1][1] if i > 0 else None
        after = delta_states[i][1] if i < len(delta_states) else None
        if before == top:
            compare["equal to the delta book at or before"] += 1
        elif after == top:
            compare["equal to the delta book just after"] += 1
        elif before is None or after is None:
            compare["outside the delta run"] += 1
        else:
            compare["equal to neither"] += 1
            if compare["equal to neither"] <= 2:
                out("compare_diff", event_time=ev, snap_top=[top[0][:3], top[1][:3]],
                    before_top=[before[0][:3], before[1][:3]], after_top=[after[0][:3], after[1][:3]])
    b, a = books["v1.book.d|BTC_USDT_Perp@100"].top(3)
    out("delta_vs_snapshot_stream", top_levels=20, counts=dict(compare))
    out("btc_delta_book_top", bids=b, asks=a, depth=[len(books["v1.book.d|BTC_USDT_Perp@100"].bids), len(books["v1.book.d|BTC_USDT_Perp@100"].asks)])
    await ws.close()


async def mode_ticker(session, perps, thin):
    ws = await connect(session)
    await ws.send_json(subscribe("v1.ticker.d", ["BTC_USDT_Perp@100", f"{thin}@100"], 1))
    await ws.send_json(subscribe("v1.ticker.s", ["ETH_USDT_Perp@500"], 2))
    await ws.send_json(subscribe("v1.mini.d", ["BTC_USDT_Perp@0"], 3))
    stats = defaultdict(SelectorStats)
    changes = defaultdict(Counter)
    state = defaultdict(dict)
    shown = Counter()

    def on_frame(frame, recv_ns, size):
        if "result" in frame or "error" in frame:
            out("ack", frame=frame)
            return
        key = f"{frame['stream']}|{frame['selector']}"
        st = stats[key]
        st.frames += 1
        st.bytes += size
        st.seq(frame)
        feed = frame["feed"]
        ev = int(feed.get("event_time") or 0)
        if ev:
            st.ages.append((recv_ns - ev) / 1e6)
            if st.last_event is not None:
                st.event_steps.append((ev - st.last_event) / 1e6)
            st.last_event = ev
        st.fields.update(k for k in feed.keys())
        for f in ("mark_price", "index_price", "funding_rate", "next_funding_time", "best_bid_price", "best_ask_price"):
            if f in feed and feed[f] != state[key].get(f):
                if f in state[key]:
                    changes[key][f] += 1
                state[key][f] = feed[f]
        if shown[key] < 3:
            shown[key] += 1
            out("frame", key=key, frame=frame)

    end = await read_for(ws, 40, on_frame)
    out("ticker_end", **end)
    for key, st in stats.items():
        s = st.summary()
        out("selector_summary", key=key, frames=s["frames"], bytes=s["bytes"], snapshots=s["snapshots"], gap_count=s["gap_count"],
            dupes=s["dupes"], prev_mismatch=s["prev_mismatch"], event_step_ms=s["event_step_ms"], age_ms=s["age_ms"],
            fields=s["fields"], changes=dict(changes[key]))
    await ws.close()


async def mode_errors(session, perps, thin):
    ws = await connect(session)
    cases = [
        ("unknown instrument", subscribe("v1.book.d", ["NOPE_USDT_Perp@100"], 11)),
        ("delisted instrument", subscribe("v1.book.d", ["TON_USDT_Perp@100"], 22)),
        ("lowercase instrument", subscribe("v1.book.d", ["btc_usdt_perp@100"], 12)),
        ("unknown stream", subscribe("v1.nope", ["BTC_USDT_Perp@100"], 13)),
        ("bad delta rate 20", subscribe("v1.book.d", ["BTC_USDT_Perp@20"], 14)),
        ("bad snapshot depth 20", subscribe("v1.book.s", ["BTC_USDT_Perp@500-20"], 15)),
        ("selector without rate", subscribe("v1.book.d", ["BTC_USDT_Perp"], 16)),
        ("one good one bad", subscribe("v1.mini.s", ["BTC_USDT_Perp@1000", "NOPE_USDT_Perp@1000"], 17)),
        ("json-rpc ticker call", {"jsonrpc": "2.0", "method": "v1/ticker", "params": {"instrument": "BTC_USDT_Perp"}, "id": 18}),
        ("unknown method", {"jsonrpc": "2.0", "method": "ping", "params": {}, "id": 19}),
        ("not json", "hello"),
    ]
    log = []

    def on_frame(frame, recv_ns, size):
        log.append(frame)

    for label, payload in cases:
        if isinstance(payload, str):
            await ws.send_str(payload)
        else:
            await ws.send_json(payload)
        log.clear()
        end = await read_for(ws, 2.0, on_frame)
        replies = [f for f in log if "feed" not in f]
        feeds = Counter(f"{f['stream']}|{f['selector']}" for f in log if "feed" in f)
        out("error_case", case=label, replies=replies[:3], feed_frames=dict(feeds), socket=end["ended"])
        if end["ended"] != "deadline":
            out("socket_closed_by_case", case=label, **end)
            ws = await connect(session)
    await ws.send_json(subscribe("v1.ticker.s", ["BTC_USDT_Perp@500"], 20))
    log.clear()
    await read_for(ws, 2.0, on_frame)
    out("valid_after_errors", replies=[f for f in log if "feed" not in f], feed_frames=sum(1 for f in log if "feed" in f))
    await ws.send_json({"jsonrpc": "2.0", "method": "unsubscribe", "params": {"stream": "v1.ticker.s", "selectors": ["BTC_USDT_Perp@500"]}, "id": 21})
    log.clear()
    await read_for(ws, 2.5, on_frame)
    out("unsubscribe", replies=[f for f in log if "feed" not in f], feed_frames_after=sum(1 for f in log if "feed" in f))
    await ws.close()


async def mode_batch(session, perps, thin):
    names = [x["instrument"] for x in perps][:50]
    ws = await connect(session)
    t_sub = time.time_ns()
    await ws.send_json(subscribe("v1.book.d", [f"{n}@100" for n in names], 1))
    await ws.send_json(subscribe("v1.ticker.d", [f"{n}@500" for n in names], 2))
    stats = defaultdict(SelectorStats)
    acks = []
    first = {}
    total = {"frames": 0, "bytes": 0}
    per_second = Counter()

    def on_frame(frame, recv_ns, size):
        if "result" in frame or "error" in frame:
            r = frame.get("result") or {}
            acks.append({"id": frame.get("id"), "stream": r.get("stream"), "subs": len(r.get("subs") or []),
                         "unsubs": len(r.get("unsubs") or []), "num_snapshots": Counter(r.get("num_snapshots") or []),
                         "first_seq_sample": (r.get("first_sequence_number") or [])[:3],
                         "latest_seq_sample": (r.get("latest_sequence_number") or [])[:3], "error": frame.get("error"),
                         "ack_ms": round((recv_ns - t_sub) / 1e6)})
            return
        key = f"{frame['stream']}|{frame['selector']}"
        total["frames"] += 1
        total["bytes"] += size
        per_second[(recv_ns - t_sub) // 1_000_000_000] += 1
        st = stats[key]
        st.frames += 1
        seq = st.seq(frame)
        if key not in first:
            first[key] = (recv_ns - t_sub) / 1e6
        ev = int(frame["feed"].get("event_time") or 0)
        if ev:
            st.ages.append((recv_ns - ev) / 1e6)

    end = await read_for(ws, 60, on_frame)
    out("batch_end", **end)
    out("batch_acks", acks=acks)
    books = [k for k in stats if k.startswith("v1.book.d")]
    tickers = [k for k in stats if k.startswith("v1.ticker.d")]
    gaps = {k: s.gaps[:3] for k, s in stats.items() if s.gaps}
    ages = [a for s in stats.values() for a in s.ages]
    secs = [per_second[s] for s in range(5, 59)]
    out("batch_summary", streams_with_frames=len(stats), books=len(books), tickers=len(tickers), frames=total["frames"],
        bytes=total["bytes"], frames_per_s=round(total["frames"] / 60, 1), bytes_per_s=round(total["bytes"] / 60),
        frames_per_s_p50=statistics.median(secs) if secs else None, frames_per_s_max=max(secs) if secs else None,
        first_frame_ms={"min": round(min(first.values())), "max": round(max(first.values()))} if first else None,
        snapshots_book=sum(stats[k].snapshots for k in books), snapshots_ticker=sum(stats[k].snapshots for k in tickers),
        gap_streams=len(gaps), gaps=dict(list(gaps.items())[:5]), dupes=sum(s.dupes for s in stats.values()),
        prev_mismatch=sum(s.prev_mismatch for s in stats.values()),
        age_ms={"p50": round(statistics.median(ages), 1), "p99": round(sorted(ages)[int(len(ages) * 0.99)], 1), "max": round(max(ages), 1)} if ages else None,
        quiet_books=[k for k in books if stats[k].frames <= 1])
    await ws.close()


async def mode_silence(session, perps, thin):
    a = await connect(session)
    b = await connect(session)
    c = await connect(session)
    await a.send_json(subscribe("v1.ticker.s", [f"{thin}@5000"], 1))
    await c.send_json(subscribe("v1.ticker.s", [f"{thin}@5000"], 1))
    frames = Counter()

    def counter(name):
        def on(frame, recv_ns, size):
            frames[name] += 1
        return on

    t0 = time.monotonic()
    ra, rb, rc = await asyncio.gather(read_for(a, 100, counter("a")), read_for(b, 100, counter("b")),
                                      read_for(c, 100, counter("c"), answer_pings=False))
    out("silence_end", seconds=round(time.monotonic() - t0, 1), subscribed_answering=ra, idle_answering=rb,
        subscribed_not_answering=rc, frames=dict(frames))
    for ws in (a, b, c):
        await ws.close()


async def mode_deflate(session, perps, thin):
    for compress in (15, 0):
        ws = await session.ws_connect(URL, autoping=False, compress=compress, heartbeat=None)
        resp = getattr(ws, "_response", None)
        headers = dict(resp.headers) if resp is not None else {}
        out("handshake", offered_deflate=bool(compress), negotiated=ws.compress, status=resp.status if resp is not None else None,
            extensions=headers.get("Sec-WebSocket-Extensions"), server=headers.get("Server"), cf_ray=headers.get("CF-RAY"),
            other={k: v for k, v in headers.items() if k.lower() not in ("date", "sec-websocket-accept", "cf-ray", "server")})
        await ws.close()


MODES = {"book": mode_book, "ticker": mode_ticker, "errors": mode_errors, "batch": mode_batch,
         "silence": mode_silence, "deflate": mode_deflate}


async def main():
    chosen = sys.argv[1:] or list(MODES)
    perps = active_perps()
    thin, vol = thinnest(perps) if any(m in chosen for m in ("book", "ticker", "silence")) else (None, None)
    out("setup", active_perps=len(perps), thinnest=thin, thinnest_24h_quote_volume=vol)
    async with aiohttp.ClientSession() as session:
        for m in chosen:
            out("mode", name=m, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            await MODES[m](session, perps, thin)


if __name__ == "__main__":
    asyncio.run(main())
