# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for C-Patex spot market data at wss://ws.c-patex.com/.

Public channels only, no authentication.
The client sends no protocol level pings, so every keepalive seen is the server's or an explicit server.ping.
The venue publishes no connection or subscription limit, so the probe opens one socket at a time.
Socket time per full run is about four and a half minutes, so the venue's total stays inside ten minutes.

Modes, each printing one JSON line per finding:
    book      ping, time, depth.subscribe BTC_USDT at limit 100 and interval "0" for 60 s.
              Applies every delta to the snapshot, checks level order, zero size removals and levels outside the limit,
              A snapshot that arrives mid-stream is compared with the maintained book trimmed to the limit.
              Then compares the maintained book with depth.query and the REST depth/result.
    multi     subscribes BTC_USDT, then ETH_USDT on the same socket, for 20 s, to see whether the second replaces the first.
    params    depth.subscribe with several limits and intervals, one at a time, and the first frame each returns.
    errors    unknown, lowercase and slash markets, bad limit, bad interval, unknown method, and malformed JSON.
              After each acknowledgement it waits 2 s for any depth.update.
    channels  price, state and deals subscribe acknowledgements and first frames for BTC_USDT.
    idle      subscribes BTC_USDT, sends one server.ping at 60 s and then nothing, and records when the server closes.
              A close near 106 s after open would mean client messages do not reset the timer.
              A close near 106 s after the ping would mean they do. The cap is 200 s.
    all       every mode above in turn.

Run from the repository root:
    uv run scripts/probes/venues/c-patex/ws-probe.py [book|multi|params|errors|channels|idle|all]

Recorded in docs/profiles/c-patex/websocket.md.
"""

import asyncio
import json
import sys
import time
import urllib.request

import websockets

URL = "wss://ws.c-patex.com/"
REST_DEPTH = "https://api.c-patex.com/api/v1/public/depth/result?market={m}&limit={n}"


def log(tag: str, **fields) -> None:
    print(json.dumps({"tag": tag, "at": round(time.time(), 3), **fields}, default=str), flush=True)


def trim(frame: str, n: int = 400) -> str:
    return frame if len(frame) <= n else frame[:n] + "..."


async def connect():
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, open_timeout=15, user_agent_header="observatory-probe", max_size=2**24,
                                    ping_interval=None)
    log("open", ms=round((time.perf_counter() - t0) * 1000), status=ws.response.status_code,
        server=ws.response.headers.get("server"), extensions=ws.response.headers.get("sec-websocket-extensions"))
    return ws


async def call(ws, method: str, params: list, rid: int, wait: float = 5.0) -> list[str]:
    """Send one request and collect frames until the reply with the same id arrives or the wait ends."""
    await ws.send(json.dumps({"method": method, "params": params, "id": rid}))
    frames = []
    end = time.monotonic() + wait
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
        except asyncio.TimeoutError:
            break
        frames.append(raw)
        if json.loads(raw).get("id") == rid:
            break
    return frames


def apply(book: dict, side: str, levels: list) -> tuple[int, int]:
    removed = updated = 0
    for price, size in levels:
        if float(size) == 0:
            if price in book[side]:
                removed += 1
            book[side].pop(price, None)
        else:
            book[side][price] = size
            updated += 1
    return removed, updated


def order_of(levels: list) -> str:
    prices = [float(p) for p, _ in levels]
    if len(prices) < 2:
        return "short"
    if prices == sorted(prices):
        return "ascending"
    if prices == sorted(prices, reverse=True):
        return "descending"
    return "unordered"


def top(book: dict, n: int) -> tuple[list, list]:
    asks = sorted(book["asks"].items(), key=lambda kv: float(kv[0]))[:n]
    bids = sorted(book["bids"].items(), key=lambda kv: -float(kv[0]))[:n]
    return asks, bids


async def mode_book() -> None:
    ws = await connect()
    for f in await call(ws, "server.ping", [], 1):
        log("ping_reply", frame=f)
    sent = time.time()
    for f in await call(ws, "server.time", [], 2):
        log("time_reply", frame=f, local_mid_s=round((sent + time.time()) / 2, 3),
            offset_s=round(json.loads(f)["result"] - (sent + time.time()) / 2, 2) if '"id":2' in f else None)
    await ws.send(json.dumps({"method": "depth.subscribe", "params": ["BTC_USDT", 100, "0"], "id": 3}))
    book = {"asks": {}, "bids": {}}
    stats = {"snapshots": 0, "deltas": 0, "removed": 0, "updated": 0, "removed_unknown": 0, "max_levels_in_delta": 0,
             "delta_orders": {}, "beyond_limit_adds": 0, "frames": 0}
    gaps, last = [], None
    t_sub = time.monotonic()
    snapshot_at = []
    end = time.monotonic() + 60
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
        except asyncio.TimeoutError:
            break
        now = time.monotonic()
        msg = json.loads(raw)
        if msg.get("id") == 3:
            log("subscribe_ack", frame=raw)
            continue
        if msg.get("method") != "depth.update":
            log("other_frame", frame=trim(raw))
            continue
        stats["frames"] += 1
        if last is not None:
            gaps.append(round(now - last, 2))
        last = now
        clean, data, market = msg["params"]
        if clean:
            stats["snapshots"] += 1
            snapshot_at.append(round(now - t_sub, 2))
            if stats["snapshots"] > 1:
                ma, mb = top(book, 100)
                sa = sorted(([p, q] for p, q in data.get("asks", [])), key=lambda x: float(x[0]))
                sb = sorted(([p, q] for p, q in data.get("bids", [])), key=lambda x: -float(x[0]))
                log("mid_stream_snapshot_vs_maintained", asks_match=[list(x) for x in ma] == sa,
                    bids_match=[list(x) for x in mb] == sb, maintained_levels=[len(book["asks"]), len(book["bids"])])
            book = {"asks": {p: s for p, s in data.get("asks", [])}, "bids": {p: s for p, s in data.get("bids", [])}}
            log("snapshot", market=market, asks=len(data.get("asks", [])), bids=len(data.get("bids", [])),
                asks_order=order_of(data.get("asks", [])), bids_order=order_of(data.get("bids", [])),
                frame=trim(raw, 600), extra_keys=sorted(set(data) - {"asks", "bids"}), params_len=len(msg["params"]))
            continue
        stats["deltas"] += 1
        n = sum(len(data.get(s, [])) for s in ("asks", "bids"))
        stats["max_levels_in_delta"] = max(stats["max_levels_in_delta"], n)
        for side in ("asks", "bids"):
            levels = data.get(side, [])
            if len(levels) >= 2:
                o = order_of(levels)
                stats["delta_orders"][f"{side}:{o}"] = stats["delta_orders"].get(f"{side}:{o}", 0) + 1
            for p, s in levels:
                if float(s) == 0 and p not in book[side]:
                    stats["removed_unknown"] += 1
            if book[side]:
                worst = max(map(float, book[side])) if side == "asks" else min(map(float, book[side]))
                for p, s in levels:
                    if float(s) > 0 and p not in book[side] and (
                            (side == "asks" and float(p) > worst) or (side == "bids" and float(p) < worst)):
                        stats["beyond_limit_adds"] += 1
            r, u = apply(book, side, levels)
            stats["removed"] += r
            stats["updated"] += u
        if stats["deltas"] <= 2:
            log("delta", frame=trim(raw, 600), extra_keys=sorted(set(data) - {"asks", "bids"}))
    gaps.sort()
    log("book_stats", **stats, snapshot_at_s=snapshot_at, levels_now={"asks": len(book["asks"]), "bids": len(book["bids"])},
        gap_s={"min": gaps[0] if gaps else None, "median": gaps[len(gaps) // 2] if gaps else None,
               "max": gaps[-1] if gaps else None, "count": len(gaps)})
    asks, bids = top(book, 5)
    log("maintained_top5", asks=asks, bids=bids, crossed=bool(asks and bids and float(bids[0][0]) >= float(asks[0][0])))
    q = await call(ws, "depth.query", ["BTC_USDT", 5, "0"], 4)
    for f in q:
        m = json.loads(f)
        if m.get("id") == 4:
            r = m["result"]
            log("depth_query", asks=r["asks"], bids=r["bids"], bids_order=order_of(r["bids"]), extra_keys=sorted(set(r) - {"asks", "bids"}))
            qa = sorted(r["asks"], key=lambda x: float(x[0]))
            qb = sorted(r["bids"], key=lambda x: -float(x[0]))
            log("maintained_vs_query_top5", asks_match=[list(x) for x in asks] == qa, bids_match=[list(x) for x in bids] == qb)
    with urllib.request.urlopen(urllib.request.Request(REST_DEPTH.format(m="BTC_USDT", n=5),
                                                       headers={"User-Agent": "observatory-probe"}), timeout=20) as resp:
        rest = json.loads(resp.read())
    ra = sorted(rest["asks"], key=lambda x: float(x[0]))
    rb = sorted(rest["bids"], key=lambda x: -float(x[0]))
    log("maintained_vs_rest_top5", asks_match=[list(x) for x in asks] == ra, bids_match=[list(x) for x in bids] == rb,
        rest_best=[ra[0], rb[0]] if ra and rb else None)
    await ws.close()


async def mode_multi() -> None:
    ws = await connect()
    await call(ws, "depth.subscribe", ["BTC_USDT", 5, "0"], 10, wait=2)
    for f in await call(ws, "depth.subscribe", ["ETH_USDT", 5, "0"], 11, wait=2):
        log("second_subscribe_frame", frame=trim(f, 200))
    counts = {}
    end = time.monotonic() + 20
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
        except asyncio.TimeoutError:
            break
        m = json.loads(raw)
        if m.get("method") == "depth.update":
            key = f"{m['params'][2]}:{'snapshot' if m['params'][0] else 'delta'}"
            counts[key] = counts.get(key, 0) + 1
    log("multi_counts_after_second_subscribe", counts=counts)
    for f in await call(ws, "depth.subscribe", [["BTC_USDT", 5, "0"], ["ETH_USDT", 5, "0"]], 12, wait=3):
        log("nested_params_subscribe", frame=trim(f, 300))
    for f in await call(ws, "depth.subscribe", ["BTC_USDT", 5, "0", "ETH_USDT", 5, "0"], 13, wait=3):
        log("flat_two_market_subscribe", frame=trim(f, 300))
    for f in await call(ws, "depth.unsubscribe", [], 14, wait=3):
        log("unsubscribe", frame=trim(f, 200))
    end = time.monotonic() + 5
    after = 0
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
            if json.loads(raw).get("method") == "depth.update":
                after += 1
        except asyncio.TimeoutError:
            break
    log("updates_in_5s_after_unsubscribe", count=after)
    await ws.close()


async def mode_params() -> None:
    ws = await connect()
    rid = 20
    for limit, interval in ((1, "0"), (5, "0"), (50, "0"), (100, "0"), (101, "0"), (200, "0"), (500, "0"), (1000, "0"), (1001, "0"), (5, "0.01"), (5, "1"), (5, "10")):
        rid += 1
        frames = await call(ws, "depth.subscribe", ["BTC_USDT", limit, interval], rid, wait=3)
        ack = next((f for f in frames if json.loads(f).get("id") == rid), None)
        snap = next((json.loads(f) for f in frames if json.loads(f).get("method") == "depth.update"), None)
        if snap is None:
            try:
                raw = await asyncio.wait_for(ws.recv(), 2)
                m = json.loads(raw)
                snap = m if m.get("method") == "depth.update" else None
            except asyncio.TimeoutError:
                pass
        log("params", limit=limit, interval=interval, ack=trim(ack or "", 200),
            first_update_clean=snap["params"][0] if snap else None,
            asks=len(snap["params"][1].get("asks", [])) if snap else None,
            bids=len(snap["params"][1].get("bids", [])) if snap else None)
        await call(ws, "depth.unsubscribe", [], rid + 100, wait=1)
    await ws.close()


async def mode_errors() -> None:
    ws = await connect()
    cases = [
        ("unknown_market", "depth.subscribe", ["NOPE_USDT", 5, "0"]),
        ("lowercase_market", "depth.subscribe", ["btc_usdt", 5, "0"]),
        ("slash_market", "depth.subscribe", ["BTC/USDT", 5, "0"]),
        ("limit_zero", "depth.subscribe", ["BTC_USDT", 0, "0"]),
        ("bad_interval", "depth.subscribe", ["BTC_USDT", 5, "abc"]),
        ("missing_params", "depth.subscribe", []),
        ("unknown_method", "depth.nope", ["BTC_USDT"]),
        ("private_without_auth", "asset.query", []),
    ]
    rid = 40
    for name, method, params in cases:
        rid += 1
        frames = await call(ws, method, params, rid, wait=3)
        updates = []
        end = time.monotonic() + 2
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), end - time.monotonic())
                updates.append(raw)
            except asyncio.TimeoutError:
                break
        log("ws_error_case", case=name, frames=[trim(f, 300) for f in frames[:3]],
            updates_in_2s=len(updates), first_update=trim(updates[0], 200) if updates else None)
        await call(ws, "depth.unsubscribe", [], rid + 100, wait=1)
    await ws.send("not json")
    try:
        raw = await asyncio.wait_for(ws.recv(), 3)
        log("ws_error_case", case="malformed_json", frames=[trim(raw, 300)])
    except asyncio.TimeoutError:
        log("ws_error_case", case="malformed_json", frames=[], note="no reply in 3 s")
    except websockets.ConnectionClosed as e:
        log("ws_error_case", case="malformed_json", closed=True, code=e.rcvd.code if e.rcvd else None)
    if ws.state.name == "OPEN":
        log("after_malformed", ping=[trim(f, 200) for f in await call(ws, "server.ping", [], 99, wait=3)])
    await ws.close()


async def mode_channels() -> None:
    ws = await connect()
    rid = 60
    for method, params in (("price.subscribe", ["BTC_USDT"]), ("state.subscribe", ["BTC_USDT"]),
                           ("deals.subscribe", ["BTC_USDT"]), ("kline.query", ["BTC_USDT", int(time.time()) - 600, int(time.time()), 60])):
        rid += 1
        frames = await call(ws, method, params, rid, wait=3)
        try:
            raw = await asyncio.wait_for(ws.recv(), 3)
            frames.append(raw)
        except asyncio.TimeoutError:
            pass
        log("channel", method=method, frames=[trim(f, 300) for f in frames[:3]])
    await ws.close()


async def mode_idle() -> None:
    ws = await connect()
    t0 = time.monotonic()
    await ws.send(json.dumps({"method": "depth.subscribe", "params": ["BTC_USDT", 5, "0"], "id": 80}))
    last_sent = time.monotonic()
    pinged = False
    frames = 0
    try:
        while time.monotonic() - t0 < 200:
            if not pinged and time.monotonic() - t0 >= 60:
                await ws.send(json.dumps({"method": "server.ping", "params": [], "id": 81}))
                last_sent = time.monotonic()
                pinged = True
                log("idle_ping_sent", at_s=round(last_sent - t0, 1))
            wait = (60 - (time.monotonic() - t0)) if not pinged else (200 - (time.monotonic() - t0))
            try:
                await asyncio.wait_for(ws.recv(), max(wait, 0.01))
                frames += 1
            except asyncio.TimeoutError:
                continue
        log("idle_result", survived_s=round(time.monotonic() - t0, 1), frames=frames, open=ws.state.name)
    except websockets.ConnectionClosed as e:
        now = time.monotonic()
        log("idle_result", closed_after_open_s=round(now - t0, 1), closed_after_last_client_message_s=round(now - last_sent, 1),
            frames=frames, code=e.rcvd.code if e.rcvd else None, reason=e.rcvd.reason if e.rcvd else None)
    await ws.close()


MODES = {"book": mode_book, "multi": mode_multi, "params": mode_params, "errors": mode_errors,
         "channels": mode_channels, "idle": mode_idle}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if mode in (name, "all"):
            log("mode", name=name)
            asyncio.run(fn())
