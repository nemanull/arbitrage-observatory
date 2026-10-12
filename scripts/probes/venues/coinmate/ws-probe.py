# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Coinmate.

Modes, all by default, or name some on the command line:
    v2      one socket on wss://coinmate.io/api/websocket for 120 s, subscribed to order_book on BTC_EUR, ETH_EUR and BTC_CZK,
            plus trades-BTC_EUR and statistics-BTC_EUR.
            It reports acks, the first frame of each kind, whether each order book push is a full book, depth per side,
            push intervals, any sequence field, level order, crossed books, server pings and their spacing,
            and the extension the server negotiated.
    v1      one socket on the version 1.0 URL wss://coinmate.io/api/websocket/channel/order-book/BTC_EUR for 30 s.
    errors  one short socket on the 2.0 URL: an unknown pair, an unknown channel, an unknown event, a frame without data,
            text that is not JSON, a client ping, a repeat subscribe and an unsubscribe.
    deflate one short socket on the 2.0 URL that offers permessage-deflate, to see whether the server accepts it.
    quiet   one socket on the 2.0 URL for 60 s subscribed to the order book of six thin pairs,
            timing the first book of each against its subscribe_success, to see whether a snapshot comes on subscribe.
    frame   one short socket on the 2.0 URL that prints the head and tail of the first BTC_EUR book frame, untrimmed in the middle only.
    idle    one socket on the 2.0 URL with no subscription and no client traffic for up to 150 s,
            to see whether the server pings, and when it closes a silent socket.

The client sends no protocol pings of its own in v2, so every ping logged is the server's.
Total socket time is about 6.5 minutes.
The flag --short halves every window, to about 3.5 minutes, for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/coinmate/ws-probe.py [--short] [mode ...]
"""

import asyncio
import json
import statistics
import sys
import time

import websockets

V2 = "wss://coinmate.io/api/websocket"
V1 = "wss://coinmate.io/api/websocket/channel/order-book/BTC_EUR"
SCALE = 0.5 if "--short" in sys.argv else 1.0
V2_S = 120 * SCALE
V1_S = 30 * SCALE
QUIET_S = 60 * SCALE
IDLE_S = 150 * SCALE
BOOK_PAIRS = ["BTC_EUR", "ETH_EUR", "BTC_CZK"]


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def trim(raw: str, n: int = 600) -> str:
    return raw if len(raw) <= n else raw[:n] + f"...(+{len(raw) - n} chars)"


def book_summary(p: dict) -> dict:
    bids, asks = p.get("bids") or [], p.get("asks") or []
    bp = [float(x["price"]) for x in bids]
    ap = [float(x["price"]) for x in asks]
    return {
        "keys": sorted(p), "level_keys": sorted(bids[0]) if bids else None, "bids": len(bids), "asks": len(asks),
        "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
        "crossed": bool(bp and ap and bp[0] >= ap[0]),
        "zero_sizes": sum(1 for x in bids + asks if float(x["amount"]) == 0),
        "best": [bp[0] if bp else None, ap[0] if ap else None],
        "duplicate_prices": len(bp) - len(set(bp)) + len(ap) - len(set(ap)),
    }


def extensions(ws) -> str | None:
    try:
        return ws.response.headers.get("Sec-WebSocket-Extensions")
    except AttributeError:
        return None


async def v2() -> None:
    t0 = time.monotonic()
    async with websockets.connect(V2, compression=None, ping_interval=None, max_size=2**23, open_timeout=20) as ws:
        out(mode="v2", event="open", url=V2, extensions=extensions(ws), status=ws.response.status_code,
            server=ws.response.headers.get("server"), cf_ray=ws.response.headers.get("cf-ray"))
        channels = [f"order_book-{p}" for p in BOOK_PAIRS] + ["trades-BTC_EUR", "statistics-BTC_EUR"]
        for ch in channels:
            frame = {"event": "subscribe", "data": {"channel": ch}}
            await ws.send(json.dumps(frame))
            out(mode="v2", event="sent", frame=frame)
        first: dict[str, str] = {}
        arrivals: dict[str, list[float]] = {}
        books: dict[str, list[dict]] = {}
        pings: list[float] = []
        events: dict[str, int] = {}
        same_as_last: dict[str, int] = {}
        last_raw: dict[str, str] = {}
        sizes: list[int] = []
        while time.monotonic() - t0 < V2_S:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=V2_S - (time.monotonic() - t0))
            except asyncio.TimeoutError:
                break
            now = round(time.monotonic() - t0, 3)
            msg = json.loads(raw)
            ev = msg.get("event")
            ch = msg.get("channel")
            key = f"{ev}:{ch}"
            events[key] = events.get(key, 0) + 1
            if key not in first:
                first[key] = trim(raw)
                out(mode="v2", event="first", t=now, key=key, raw=trim(raw, 900))
            if ev == "ping":
                pings.append(now)
                await ws.send(json.dumps({"event": "pong"}))
            if ev == "data" and ch and ch.startswith("order_book-"):
                arrivals.setdefault(ch, []).append(now)
                books.setdefault(ch, []).append(book_summary(msg.get("payload") or {}))
                sizes.append(len(raw))
                payload_raw = json.dumps(msg.get("payload"), sort_keys=True)
                if last_raw.get(ch) == payload_raw:
                    same_as_last[ch] = same_as_last.get(ch, 0) + 1
                last_raw[ch] = payload_raw
        out(mode="v2", event="counts", seconds=V2_S, events=events)
        out(mode="v2", event="server_pings", at=pings,
            gaps=[round(b - a, 1) for a, b in zip(pings, pings[1:])])
        for ch, ts in arrivals.items():
            gaps = [round(b - a, 3) for a, b in zip(ts, ts[1:])]
            bs = books[ch]
            out(mode="v2", event="book_stats", channel=ch, pushes=len(ts),
                gap_median_s=statistics.median(gaps) if gaps else None, gap_max_s=max(gaps) if gaps else None,
                gap_min_s=min(gaps) if gaps else None,
                bids_counts=sorted({b["bids"] for b in bs}), asks_counts=sorted({b["asks"] for b in bs}),
                level_keys=bs[0]["level_keys"], payload_keys=bs[0]["keys"],
                all_bids_descending=all(b["bids_descending"] for b in bs),
                all_asks_ascending=all(b["asks_ascending"] for b in bs),
                crossed=sum(b["crossed"] for b in bs), zero_sizes=sum(b["zero_sizes"] for b in bs),
                duplicate_prices_max=max(b["duplicate_prices"] for b in bs),
                identical_to_previous=same_as_last.get(ch, 0), first_best=bs[0]["best"], last_best=bs[-1]["best"])
        if sizes:
            out(mode="v2", event="book_frame_bytes", median=statistics.median(sizes), max=max(sizes))


async def v1() -> None:
    t0 = time.monotonic()
    try:
        async with websockets.connect(V1, compression=None, ping_interval=None, open_timeout=20) as ws:
            out(mode="v1", event="open", url=V1, status=ws.response.status_code, extensions=extensions(ws))
            n = 0
            kinds: dict[str, int] = {}
            while time.monotonic() - t0 < V1_S:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=V1_S - (time.monotonic() - t0))
                except asyncio.TimeoutError:
                    break
                msg = json.loads(raw)
                k = f"{msg.get('event')}:{msg.get('channel')}"
                kinds[k] = kinds.get(k, 0) + 1
                if n < 2:
                    out(mode="v1", event="frame", t=round(time.monotonic() - t0, 3), raw=trim(raw, 500))
                if msg.get("event") == "data" and n < 2:
                    out(mode="v1", event="book", summary=book_summary(msg.get("payload") or {}))
                n += 1
            out(mode="v1", event="counts", seconds=V1_S, kinds=kinds)
    except Exception as e:
        out(mode="v1", event="fail", error=repr(e))


async def recv_for(ws, seconds: float, label: str) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            out(mode="errors", case=label, event="closed", code=e.rcvd.code if e.rcvd else None,
                reason=e.rcvd.reason if e.rcvd else None)
            raise
        msg = json.loads(raw) if raw.startswith("{") else raw
        if isinstance(msg, dict) and msg.get("event") == "data":
            continue
        out(mode="errors", case=label, reply=trim(raw, 400))


async def errors() -> None:
    cases = [
        ("unknown pair", json.dumps({"event": "subscribe", "data": {"channel": "order_book-FOO_BAR"}})),
        ("lower case pair", json.dumps({"event": "subscribe", "data": {"channel": "order_book-btc_eur"}})),
        ("unknown channel", json.dumps({"event": "subscribe", "data": {"channel": "depth-BTC_EUR"}})),
        ("unknown event", json.dumps({"event": "hello", "data": {"channel": "order_book-BTC_EUR"}})),
        ("no data", json.dumps({"event": "subscribe"})),
        ("not json", "this is not json"),
        ("client ping", json.dumps({"event": "ping"})),
        ("subscribe", json.dumps({"event": "subscribe", "data": {"channel": "order_book-LTC_EUR"}})),
        ("repeat subscribe", json.dumps({"event": "subscribe", "data": {"channel": "order_book-LTC_EUR"}})),
        ("unsubscribe", json.dumps({"event": "unsubscribe", "data": {"channel": "order_book-LTC_EUR"}})),
        ("unsubscribe again", json.dumps({"event": "unsubscribe", "data": {"channel": "order_book-LTC_EUR"}})),
    ]
    for label, frame in cases:
        # One socket per case, so a close on one bad frame does not hide the next.
        try:
            async with websockets.connect(V2, compression=None, ping_interval=None, open_timeout=20) as ws:
                await ws.send(frame)
                out(mode="errors", case=label, sent=frame)
                await recv_for(ws, 3, label)
        except websockets.ConnectionClosed:
            pass
        except Exception as e:
            out(mode="errors", case=label, event="fail", error=repr(e))
        await asyncio.sleep(0.5)


async def deflate() -> None:
    async with websockets.connect(V2, compression="deflate", ping_interval=None, open_timeout=20) as ws:
        out(mode="deflate", event="open", offered="permessage-deflate", extensions=extensions(ws))
        await ws.send(json.dumps({"event": "subscribe", "data": {"channel": "order_book-BTC_EUR"}}))
        raw = await asyncio.wait_for(ws.recv(), timeout=10)
        out(mode="deflate", event="first", raw=trim(raw, 200))


QUIET_PAIRS = ["ADA_CZK", "XRP_CZK", "LTC_CZK", "SOL_CZK", "USDC_CZK", "ETH_BTC"]


async def quiet() -> None:
    t0 = time.monotonic()
    async with websockets.connect(V2, compression=None, ping_interval=None, max_size=2**23, open_timeout=20) as ws:
        for p in QUIET_PAIRS:
            await ws.send(json.dumps({"event": "subscribe", "data": {"channel": f"order_book-{p}"}}))
        acked: dict[str, float] = {}
        books: dict[str, list[float]] = {}
        while time.monotonic() - t0 < QUIET_S:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=QUIET_S - (time.monotonic() - t0))
            except asyncio.TimeoutError:
                break
            now = round(time.monotonic() - t0, 3)
            msg = json.loads(raw)
            if msg.get("event") == "subscribe_success":
                acked[msg["data"]["channel"]] = now
            elif msg.get("event") == "data":
                books.setdefault(msg["channel"], []).append(now)
            else:
                out(mode="quiet", event="other", t=now, raw=trim(raw, 300))
        for p in QUIET_PAIRS:
            ch = f"order_book-{p}"
            ts = books.get(ch, [])
            out(mode="quiet", channel=ch, ack_s=acked.get(ch), first_book_s=ts[0] if ts else None,
                first_after_ack_s=round(ts[0] - acked[ch], 3) if ts and ch in acked else None, pushes=len(ts),
                max_gap_s=max([round(b - a, 1) for a, b in zip(ts, ts[1:])], default=None))


async def frame() -> None:
    async with websockets.connect(V2, compression=None, ping_interval=None, max_size=2**23, open_timeout=20) as ws:
        await ws.send(json.dumps({"event": "subscribe", "data": {"channel": "order_book-BTC_EUR"}}))
        end = time.monotonic() + 15
        while time.monotonic() < end:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.monotonic())
            msg = json.loads(raw)
            if msg.get("event") == "data":
                out(mode="frame", top_keys=list(msg), payload_keys=list(msg["payload"]), bytes=len(raw),
                    head=raw[:420], tail=raw[-260:])
                return


async def idle() -> None:
    t0 = time.monotonic()
    try:
        async with websockets.connect(V2, compression=None, ping_interval=None, open_timeout=20) as ws:
            out(mode="idle", event="open")
            while time.monotonic() - t0 < IDLE_S:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=IDLE_S - (time.monotonic() - t0))
                    out(mode="idle", event="frame", t=round(time.monotonic() - t0, 1), raw=trim(raw, 200))
                except asyncio.TimeoutError:
                    break
            out(mode="idle", event="still_open", t=round(time.monotonic() - t0, 1))
    except websockets.ConnectionClosed as e:
        out(mode="idle", event="closed", t=round(time.monotonic() - t0, 1),
            code=e.rcvd.code if e.rcvd else None, reason=e.rcvd.reason if e.rcvd else None)


async def main(modes: list[str]) -> None:
    table = {"v2": v2, "v1": v1, "errors": errors, "deflate": deflate, "quiet": quiet, "frame": frame, "idle": idle}
    for m in modes or list(table):
        out(mode=m, event="start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        await table[m]()


if __name__ == "__main__":
    asyncio.run(main([a for a in sys.argv[1:] if a != "--short"]))
