# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9"]
# ///
"""Read-only WebSocket probe for dYdX (CCXT id dydx), the public Indexer socket.

The socket is wss://indexer.dydx.trade/v4/ws, documented at https://docs.dydx.xyz/indexer-client/websockets
and https://docs.dydx.xyz/interaction/data/feeds.
Only public channels are used: v4_orderbook, v4_markets and v4_block_height.
aiohttp is used with autoping off, so the probe sees the server's protocol pings and answers them itself.

Modes, all by default, or name some on the command line:
    connect   two handshakes, one offering permessage-deflate, with status, headers and the "connected" frame
    book      every ACTIVE market's v4_orderbook, unbatched, on connections of 32, for 30 s:
              snapshot shape and order, delta shape, message_id steps, crossed books and their ages,
              rates, and the local book against a REST snapshot at the end
    batched   32 markets with "batched": true on one connection for 30 s
    markets   v4_markets and v4_block_height on one connection for 30 s, with a REST read every 5 s
    limits    31 orderbooks on one connection, a duplicate, the 32nd and the 33rd, then an unknown market, an unknown channel,
              a frame that is not JSON, an unsubscribe of a market not subscribed and an application ping, paced 0.7 s apart
    silence   one connection that never answers a ping, until the server closes it or 50 s pass

Socket time for every mode is about 3.5 minutes, one mode at a time.
Captures land in .claude/survey-work/dydx/captures/ under the repository root.

Run from the repository root:
    uv run scripts/probes/venues/dydx/ws-probe.py [mode ...]
"""

import asyncio
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict

import aiohttp

URL = "wss://indexer.dydx.trade/v4/ws"
REST = "https://indexer.dydx.trade/v4"
UA = "arbitrage-observatory-survey-probe"
CAPTURES = os.path.join(".claude", "survey-work", "dydx", "captures")
PER_CONNECTION = 32  # V4_ORDERBOOK_CHANNEL_LIMIT in the socks config


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def now_ms() -> float:
    return time.time() * 1000


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


def rest(path: str) -> dict:
    req = urllib.request.Request(REST + path, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as resp:
        return json.loads(resp.read())


def active_tickers() -> list[str]:
    markets = rest("/perpetualMarkets")["markets"]
    return sorted(t for t, m in markets.items() if m.get("status") == "ACTIVE")


def iso_ms(text: str) -> float:
    base, _, frac = text.rstrip("Z").partition(".")
    import calendar
    return calendar.timegm(time.strptime(base, "%Y-%m-%dT%H:%M:%S")) * 1000 + int((frac + "000")[:3])


def trim(obj, n: int = 3):
    """A frame with every list cut to n items, for the record."""
    if isinstance(obj, list):
        return [trim(x, n) for x in obj[:n]] + ([f"... {len(obj) - n} more"] if len(obj) > n else [])
    if isinstance(obj, dict):
        items = list(obj.items())
        kept = {k: trim(v, n) for k, v in items[:12]}
        if len(items) > 12:
            kept["..."] = f"{len(items) - 12} more keys"
        return kept
    return obj


async def connect(session: aiohttp.ClientSession, compress: int = 0):
    t0 = time.perf_counter()
    ws = await session.ws_connect(URL, autoping=False, autoclose=False, compress=compress, max_msg_size=0,
                                  headers={"User-Agent": UA}, timeout=aiohttp.ClientWSTimeout(ws_receive=None, ws_close=5))
    ms = (time.perf_counter() - t0) * 1000
    return ws, ms


async def mode_connect() -> None:
    async with aiohttp.ClientSession() as session:
        for compress in (15, 0):
            ws, ms = await connect(session, compress)
            headers = {k.lower(): v for k, v in ws._response.headers.items()}
            msg = await ws.receive(timeout=10)
            out(mode="connect", at=stamp(), offered_deflate=bool(compress), handshake_ms=round(ms, 1), status=ws._response.status,
                negotiated_compress=ws.compress, extensions=headers.get("sec-websocket-extensions"),
                headers={k: headers[k] for k in ("server", "cf-ray", "geo-origin-country", "geo-origin-status") if k in headers},
                first_frame=msg.data if msg.type == aiohttp.WSMsgType.TEXT else str(msg.type))
            await ws.close()


class Book:
    def __init__(self):
        self.bids: dict[str, tuple[float, float, int]] = {}  # price string to (price, size, message_id)
        self.asks: dict[str, tuple[float, float, int]] = {}
        self.updated: dict[tuple[str, str], float] = {}  # (side, price) to arrival ms
        self.crossed_since = 0.0
        self.episodes: list[float] = []
        self.crossed_frames = 0
        self.frames = 0
        self.deletes = 0
        self.snapshot_levels = (0, 0)

    def best(self):
        bid = max((v[0] for v in self.bids.values()), default=None)
        ask = min((v[0] for v in self.asks.values()), default=None)
        return bid, ask


def apply_levels(book: Book, side: str, levels, mid: int, recv: float, shapes: Counter) -> None:
    store = book.bids if side == "bids" else book.asks
    for level in levels:
        if isinstance(level, dict):
            shapes["dict:" + ",".join(sorted(level))] += 1
            price, size = level["price"], level["size"]
        else:
            shapes[f"list:{len(level)}"] += 1
            price, size = level[0], level[1]
        if float(size) == 0:
            store.pop(price, None)
            book.deletes += 1
        else:
            store[price] = (float(price), float(size), mid)
        book.updated[(side, price)] = recv


async def run_book_connection(session, tickers: list[str], seconds: float, batched: bool, stats: dict, books: dict) -> None:
    ws, ms = await connect(session)
    conn = {"handshake_ms": round(ms, 1), "markets": len(tickers), "types": Counter(), "id_steps": Counter(), "pings": [], "bytes": 0, "frames": 0,
            "max_frame": 0, "versions": Counter(), "batch_sizes": Counter(), "first_snapshot_ms": [],
            "steady_id_steps": Counter(), "subscribed_seen": 0, "last_subscribed_s": None}
    stats.setdefault("conns", []).append(conn)
    shapes = stats.setdefault("shapes", Counter())
    sent_at = {}
    last_id = None
    t_open = now_ms()
    done_subscribing = False

    async def subscribe():
        nonlocal done_subscribing
        for t in tickers:
            frame = {"type": "subscribe", "channel": "v4_orderbook", "id": t}
            if batched:
                frame["batched"] = True
            sent_at[t] = now_ms()
            await ws.send_str(json.dumps(frame))
            await asyncio.sleep(0.03)
        done_subscribing = True

    sub_task = asyncio.create_task(subscribe())
    end = time.time() + seconds
    while time.time() < end:
        try:
            msg = await ws.receive(timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        recv = now_ms()
        if msg.type == aiohttp.WSMsgType.PING:
            conn["pings"].append(round((recv - t_open) / 1000, 1))
            await ws.pong(msg.data)
            continue
        if msg.type != aiohttp.WSMsgType.TEXT:
            conn["types"][str(msg.type)] += 1
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                conn["closed"] = {"type": str(msg.type), "data": msg.data, "extra": msg.extra, "at_s": round((recv - t_open) / 1000, 1)}
                break
            continue
        conn["frames"] += 1
        conn["bytes"] += len(msg.data)
        conn["max_frame"] = max(conn["max_frame"], len(msg.data))
        data = json.loads(msg.data)
        kind = data.get("type")
        conn["types"][kind] += 1
        mid = data.get("message_id")
        if mid is not None:
            if last_id is not None:
                conn["id_steps"][mid - last_id] += 1
                # once every snapshot of the connection is in, only data frames remain
                if conn["subscribed_seen"] == len(tickers) and kind != "subscribed":
                    conn["steady_id_steps"][mid - last_id] += 1
                    if mid - last_id != 1:
                        stats.setdefault("steady_gaps", []).append({"at_s": round((recv - t_open) / 1000, 2), "from": last_id, "to": mid,
                                                                    "type": kind, "market": data.get("id")})
            last_id = mid
        if kind == "subscribed":
            conn["subscribed_seen"] += 1
            conn["last_subscribed_s"] = round((recv - t_open) / 1000, 2)
        if "version" in data:
            conn["versions"][data["version"]] += 1
        ticker = data.get("id")
        if kind == "subscribed" and data.get("channel") == "v4_orderbook":
            book = books[ticker] = Book()
            contents = data.get("contents", {})
            bids, asks = contents.get("bids", []), contents.get("asks", [])
            book.snapshot_levels = (len(bids), len(asks))
            bp = [float(level["price"]) for level in bids]
            ap = [float(level["price"]) for level in asks]
            stats.setdefault("snapshot_order", Counter())[(bp == sorted(bp, reverse=True), ap == sorted(ap))] += 1
            stats.setdefault("snapshot_bytes", {})[ticker] = len(msg.data)
            conn["first_snapshot_ms"].append(round(recv - sent_at.get(ticker, recv)))
            apply_levels(book, "bids", bids, mid, recv, shapes)
            apply_levels(book, "asks", asks, mid, recv, shapes)
            if ticker == "BTC-USD" and "btc_snapshot" not in stats:
                stats["btc_snapshot"] = trim(data, 3)
            continue
        if kind in ("channel_data", "channel_batch_data") and data.get("channel") == "v4_orderbook":
            book = books.get(ticker)
            if book is None:
                stats.setdefault("delta_before_snapshot", Counter())[ticker] += 1
                continue
            updates = data["contents"] if kind == "channel_batch_data" else [data["contents"]]
            if kind == "channel_batch_data":
                conn["batch_sizes"][len(updates)] += 1
            for contents in updates:
                book.frames += 1
                if not contents.get("bids") and not contents.get("asks"):
                    stats.setdefault("empty_deltas", Counter())[ticker] += 1
                apply_levels(book, "bids", contents.get("bids", []), mid, recv, shapes)
                apply_levels(book, "asks", contents.get("asks", []), mid, recv, shapes)
            if "delta_example" not in stats and kind == "channel_data":
                stats["delta_example"] = trim(data, 3)
            if "batch_example" not in stats and kind == "channel_batch_data":
                stats["batch_example"] = trim(data, 2)
            bid, ask = book.best()
            if bid is not None and ask is not None and bid >= ask:
                book.crossed_frames += 1
                if not book.crossed_since:
                    book.crossed_since = recv
                    # which side of the cross is older, judged by when each level last changed on this socket
                    bid_age = recv - max(t for (s, p), t in book.updated.items() if s == "bids" and float(p) == bid)
                    ask_age = recv - max(t for (s, p), t in book.updated.items() if s == "asks" and float(p) == ask)
                    stats.setdefault("cross_starts", []).append({"ticker": ticker, "bid": bid, "ask": ask,
                                                                   "bid_age_ms": round(bid_age), "ask_age_ms": round(ask_age)})
            elif book.crossed_since:
                book.episodes.append(recv - book.crossed_since)
                book.crossed_since = 0.0
            continue
        if kind == "error":
            stats.setdefault("errors", []).append(data)
            continue
        if kind not in ("connected",):
            stats.setdefault("other_frames", []).append(trim(data, 2))
    await sub_task
    await ws.close()


async def mode_book(seconds: float = 30, batched: bool = False, limit: int | None = None) -> None:
    tickers = active_tickers()
    if limit:
        tickers = tickers[:limit]
    chunks = [tickers[i:i + PER_CONNECTION] for i in range(0, len(tickers), PER_CONNECTION)]
    stats: dict = {}
    books: dict[str, Book] = {}
    mode = "batched" if batched else "book"
    t0 = time.time()
    compare = {}

    async def compare_with_rest():
        # the local book against REST while the sockets still run, with a query string so Cloudflare's 1 s cache is not served
        await asyncio.sleep(seconds - 6)
        for t in ["BTC-USD", "ETH-USD", "SOL-USD", "JTO-USD"]:
            if t not in books:
                continue
            before = now_ms()
            snap = await asyncio.to_thread(rest, f"/orderbooks/perpetualMarket/{t}?probe={int(before)}")
            after = now_ms()
            b = books[t]
            local_bids = sorted((v[0] for v in b.bids.values()), reverse=True)[:10]
            local_asks = sorted(v[0] for v in b.asks.values())[:10]
            rest_bids = [float(level["price"]) for level in snap["bids"][:10]]
            rest_asks = [float(level["price"]) for level in snap["asks"][:10]]
            local_bid_sizes = {v[0]: v[1] for v in b.bids.values()}
            local_ask_sizes = {v[0]: v[1] for v in b.asks.values()}
            compare[t] = {"rest_ms": round(after - before),
                          "top10_bid_prices_equal": sum(1 for x, y in zip(local_bids, rest_bids) if x == y),
                          "top10_ask_prices_equal": sum(1 for x, y in zip(local_asks, rest_asks) if x == y),
                          "top10_levels_equal_with_size": sum(1 for level in snap["bids"][:10] if local_bid_sizes.get(float(level["price"])) == float(level["size"]))
                          + sum(1 for level in snap["asks"][:10] if local_ask_sizes.get(float(level["price"])) == float(level["size"])),
                          "local_touch": [local_bids[:1], local_asks[:1]], "rest_touch": [rest_bids[:1], rest_asks[:1]],
                          "local_levels": [len(b.bids), len(b.asks)], "rest_levels": [len(snap["bids"]), len(snap["asks"])]}

    async with aiohttp.ClientSession() as session:
        await asyncio.gather(compare_with_rest(), *(run_book_connection(session, chunk, seconds, batched, stats, books) for chunk in chunks))
        elapsed = time.time() - t0
    for i, c in enumerate(stats.get("conns", [])):
        out(mode=mode, at=stamp(), connection=i, markets=c["markets"], handshake_ms=c["handshake_ms"],
            frames=c["frames"], bytes=c["bytes"], max_frame=c["max_frame"], types=dict(c["types"]),
            last_snapshot_at_s=c["last_subscribed_s"], steady_message_id_steps=dict(c["steady_id_steps"]),
            message_id_steps_all=dict(sorted(c["id_steps"].items(), key=lambda kv: -kv[1])[:6]),
            versions=dict(c["versions"]), server_pings_at_s=c["pings"], closed=c.get("closed"), batch_sizes=dict(c["batch_sizes"]),
            first_snapshot_ms=({"min": min(c["first_snapshot_ms"]), "median": statistics.median(c["first_snapshot_ms"]), "max": max(c["first_snapshot_ms"])}
                               if c["first_snapshot_ms"] else None))
    frames = sum(c["frames"] for c in stats.get("conns", []))
    total_bytes = sum(c["bytes"] for c in stats.get("conns", []))
    out(mode=mode, markets=len(tickers), seconds=round(elapsed, 1), frames_per_s=round(frames / elapsed, 1), kib_per_s=round(total_bytes / elapsed / 1024, 1),
        level_shapes=dict(stats.get("shapes", {})), snapshot_order={f"bids_desc={a},asks_asc={b}": n for (a, b), n in stats.get("snapshot_order", {}).items()})
    snap_levels = sorted((max(b.snapshot_levels), t) for t, b in books.items())
    out(mode=mode, snapshot_levels_per_side={"min": snap_levels[0] if snap_levels else None, "max": snap_levels[-1] if snap_levels else None},
        snapshot_bytes_max=max(stats.get("snapshot_bytes", {"none": 0}).items(), key=lambda kv: kv[1]),
        one_sided_or_empty_snapshots=[t for t, b in books.items() if not b.snapshot_levels[0] or not b.snapshot_levels[1]])
    deltas = sorted(((b.frames, t) for t, b in books.items()), reverse=True)
    out(mode=mode, delta_updates_top=deltas[:5], delta_updates_zero=[t for f, t in deltas if f == 0], deletes=sum(b.deletes for b in books.values()),
        empty_deltas=dict(stats.get("empty_deltas", {})), delta_before_snapshot=dict(stats.get("delta_before_snapshot", {})))
    crossed = {t: {"crossed_frames": b.crossed_frames, "of_frames": b.frames, "episodes": len(b.episodes) + (1 if b.crossed_since else 0),
                   "longest_ms": round(max(b.episodes, default=0)), "still_crossed_at_end": bool(b.crossed_since)}
               for t, b in books.items() if b.crossed_frames}
    out(mode=mode, markets_ever_crossed=len(crossed), crossed=crossed)
    starts = stats.get("cross_starts", [])
    older = Counter("bid older" if s["bid_age_ms"] > s["ask_age_ms"] else "ask older" if s["ask_age_ms"] > s["bid_age_ms"] else "same" for s in starts)
    out(mode=mode, cross_starts=len(starts), older_side=dict(older), cross_start_examples=starts[:6])
    out(mode=mode, rest_compare=compare)
    if "btc_snapshot" in stats:
        out(mode=mode, btc_snapshot_trimmed=stats["btc_snapshot"])
    if "delta_example" in stats:
        out(mode=mode, delta_example=stats["delta_example"])
    if "batch_example" in stats:
        out(mode=mode, batch_example=stats["batch_example"])
    out(mode=mode, steady_gaps=stats.get("steady_gaps", []))
    if stats.get("errors"):
        out(mode=mode, errors=stats["errors"][:5])
    if stats.get("other_frames"):
        out(mode=mode, other_frames=stats["other_frames"][:5])


async def mode_markets(seconds: float = 30) -> None:
    async with aiohttp.ClientSession() as session:
        ws, ms = await connect(session)
        t_open = now_ms()
        await ws.send_str(json.dumps({"type": "subscribe", "channel": "v4_markets"}))
        await ws.send_str(json.dumps({"type": "subscribe", "channel": "v4_block_height"}))
        id_steps = Counter()
        last_id = None
        oracle_frames = []  # (recv, markets in frame, ages)
        trading_fields = Counter()
        trading_frames = 0
        blocks = []  # (recv, height, block time ms)
        latest_btc = {}  # height to oracle price
        rest_checks = []
        examples = {}
        next_rest = time.time() + 5
        end = time.time() + seconds
        pings = []
        while time.time() < end:
            try:
                msg = await ws.receive(timeout=max(0.1, min(end, next_rest) - time.time()))
            except asyncio.TimeoutError:
                msg = None
            if time.time() >= next_rest:
                next_rest += 5
                r = rest("/perpetualMarkets?market=BTC-USD")["markets"]["BTC-USD"]["oraclePrice"]
                heights = sorted(latest_btc)
                matches = [h for h in heights if latest_btc[h] == r]
                rest_checks.append({"at": stamp(), "rest_oracle": r, "socket_latest_height": heights[-1] if heights else None,
                                    "rest_matches_heights": matches[-3:], "socket_latest": latest_btc[heights[-1]] if heights else None})
            if msg is None:
                continue
            recv = now_ms()
            if msg.type == aiohttp.WSMsgType.PING:
                pings.append(round((recv - t_open) / 1000, 1))
                await ws.pong(msg.data)
                continue
            if msg.type != aiohttp.WSMsgType.TEXT:
                out(mode="markets", other=str(msg.type), data=msg.data)
                break
            data = json.loads(msg.data)
            mid = data.get("message_id")
            if mid is not None:
                if last_id is not None:
                    id_steps[mid - last_id] += 1
                last_id = mid
            kind, channel = data.get("type"), data.get("channel")
            if kind == "subscribed" and channel == "v4_markets":
                markets = data["contents"]["markets"]
                save_path = os.path.join(CAPTURES, "v4_markets-subscribed.json")
                os.makedirs(CAPTURES, exist_ok=True)
                with open(save_path, "w") as f:
                    f.write(msg.data)
                out(mode="markets", at=stamp(), subscribed_bytes=len(msg.data), markets=len(markets),
                    fields=sorted({k for m in markets.values() for k in m}), btc=markets.get("BTC-USD"))
                continue
            if kind == "subscribed" and channel == "v4_block_height":
                out(mode="markets", block_height_subscribed=data.get("contents"))
                continue
            if kind == "channel_data" and channel == "v4_markets":
                contents = data["contents"]
                if "oraclePrices" in contents:
                    prices = contents["oraclePrices"]
                    ages = [recv - iso_ms(p["effectiveAt"]) for p in prices.values() if "effectiveAt" in p]
                    oracle_frames.append((recv, len(prices), ages))
                    for t, p in prices.items():
                        if t == "BTC-USD":
                            latest_btc[int(p.get("effectiveAtHeight", 0))] = p.get("oraclePrice")
                    examples.setdefault("oracle", trim(data, 2))
                if "trading" in contents:
                    trading_frames += 1
                    for m in contents["trading"].values():
                        trading_fields.update(m.keys())
                    examples.setdefault("trading", trim(data, 2))
                continue
            if kind == "channel_data" and channel == "v4_block_height":
                c = data["contents"]
                blocks.append((recv, int(c["blockHeight"]), iso_ms(c["time"])))
                examples.setdefault("block", data)
                continue
            examples.setdefault("other", []).append(trim(data, 2))
        await ws.close()
    gaps = [b[0] - a[0] for a, b in zip(oracle_frames, oracle_frames[1:])]
    ages = [a for f in oracle_frames for a in f[2]]
    sizes = [f[1] for f in oracle_frames]
    out(mode="markets", oracle_frames=len(oracle_frames), seconds=seconds,
        oracle_gap_ms={"min": round(min(gaps)), "median": round(statistics.median(gaps)), "max": round(max(gaps))} if gaps else None,
        markets_per_oracle_frame={"min": min(sizes), "median": statistics.median(sizes), "max": max(sizes)} if sizes else None,
        oracle_age_at_arrival_ms={"min": round(min(ages)), "median": round(statistics.median(ages)), "max": round(max(ages))} if ages else None,
        btc_oracle_updates=len(latest_btc))
    out(mode="markets", trading_frames=trading_frames, trading_fields=dict(trading_fields), message_id_steps=dict(id_steps), server_pings_at_s=pings)
    bgaps = [b[2] - a[2] for a, b in zip(blocks, blocks[1:])]
    bages = [r - t for r, h, t in blocks]
    hsteps = Counter(b[1] - a[1] for a, b in zip(blocks, blocks[1:]))
    out(mode="markets", blocks=len(blocks), block_time_gap_ms={"min": min(bgaps), "median": statistics.median(bgaps), "max": max(bgaps)} if bgaps else None,
        block_age_at_arrival_ms={"min": round(min(bages)), "median": round(statistics.median(bages)), "max": round(max(bages))} if bages else None,
        height_steps=dict(hsteps))
    out(mode="markets", rest_vs_socket=rest_checks)
    for k, v in examples.items():
        out(mode="markets", example=k, frame=v if k != "other" else v[:4])


async def mode_limits() -> None:
    tickers = active_tickers()
    async with aiohttp.ClientSession() as session:
        ws, ms = await connect(session)
        replies = []
        t_open = now_ms()

        async def reader():
            while True:
                msg = await ws.receive()
                recv = now_ms()
                if msg.type == aiohttp.WSMsgType.PING:
                    await ws.pong(msg.data)
                    continue
                if msg.type != aiohttp.WSMsgType.TEXT:
                    replies.append({"at_s": round((recv - t_open) / 1000, 2), "type": str(msg.type), "data": msg.data, "extra": msg.extra})
                    return
                data = json.loads(msg.data)
                if data.get("type") in ("channel_data", "channel_batch_data"):
                    continue
                replies.append({"at_s": round((recv - t_open) / 1000, 2), "type": data.get("type"), "id": data.get("id"),
                                "channel": data.get("channel"), "message": data.get("message"), "message_id": data.get("message_id")})

        task = asyncio.create_task(reader())
        # 31 books, a duplicate while under the cap, then the 32nd and the 33rd
        for t in tickers[:31]:
            await ws.send_str(json.dumps({"type": "subscribe", "channel": "v4_orderbook", "id": t}))
            await asyncio.sleep(0.05)
        await asyncio.sleep(1.5)
        for name, t in (("duplicate_under_cap", tickers[0]), ("32nd", tickers[31]), ("33rd", tickers[32])):
            replies.append({"sent": name, "at_s": round((now_ms() - t_open) / 1000, 2)})
            await ws.send_str(json.dumps({"type": "subscribe", "channel": "v4_orderbook", "id": t}))
            await asyncio.sleep(0.7)
        probes = [
            ("unknown_orderbook_market_at_cap", json.dumps({"type": "subscribe", "channel": "v4_orderbook", "id": "FOO-USD"})),
            ("unknown_market", json.dumps({"type": "subscribe", "channel": "v4_trades", "id": "FOO-USD"})),
            ("lowercase_market", json.dumps({"type": "subscribe", "channel": "v4_trades", "id": "btc-usd"})),
            ("unknown_channel", json.dumps({"type": "subscribe", "channel": "v4_nosuch", "id": "BTC-USD"})),
            ("not_json", "not json"),
            ("unsubscribe_unknown", json.dumps({"type": "unsubscribe", "channel": "v4_trades", "id": "ETH-USD"})),
            ("app_ping", json.dumps({"type": "ping"})),
        ]
        for name, frame in probes:
            replies.append({"sent": name, "at_s": round((now_ms() - t_open) / 1000, 2)})
            if ws.closed:
                break
            await ws.send_str(frame)
            await asyncio.sleep(0.7)
        await asyncio.sleep(2)
        task.cancel()
        closed = ws.closed
        await ws.close()
    subscribed = sum(1 for r in replies if r.get("type") == "subscribed")
    out(mode="limits", at=stamp(), subscribed=subscribed, closed_by_server=closed)
    for r in replies:
        if r.get("type") != "subscribed":
            out(mode="limits", reply=r)


async def mode_silence(max_s: float = 50) -> None:
    async with aiohttp.ClientSession() as session:
        ws, ms = await connect(session)
        t_open = now_ms()
        events = []
        end = time.time() + max_s
        while time.time() < end:
            try:
                msg = await ws.receive(timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            at = round((now_ms() - t_open) / 1000, 1)
            if msg.type == aiohttp.WSMsgType.TEXT:
                events.append({"at_s": at, "text": msg.data[:200]})
                continue
            events.append({"at_s": at, "type": str(msg.type), "data": msg.data if not isinstance(msg.data, bytes) else msg.data.hex(), "extra": msg.extra})
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                break
        out(mode="silence", at=stamp(), close_code=ws.close_code, events=events)
        await ws.close()


MODES = {"connect": mode_connect, "book": mode_book, "batched": lambda: mode_book(30, True, PER_CONNECTION),
         "markets": mode_markets, "limits": mode_limits, "silence": mode_silence}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    for name in chosen:
        asyncio.run(MODES[name]())
