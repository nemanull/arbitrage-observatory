# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Ndax, the AlphaPoint gateway at wss://api.ndax.io/WSGateway.

Modes, all by default, or name some on the command line:
    book     one socket for 120 s with SubscribeLevel2 at Depth 20 on BTCCAD, ETHCAD, XRPCAD, BTCUSD and the thin CCCAD.
             It reports the snapshot reply, the event frames, the MDUpdateId run per instrument and per socket, the frame counter i, action types, level order, the book size a side as the deltas are applied, crossed books, and row timestamps against arrival.
             At the end it compares the kept top 20 with a REST snapshot.
    depth    one short socket with SubscribeLevel2 on BTCCAD at Depth 1, 100 and 500, counting snapshot rows.
    errors   one short socket: an unknown instrument, a Symbol in place of the id, a repeat subscribe, an unknown function, a payload that is an object and not a string, text that is not JSON, a Ping, and UnsubscribeLevel2.
    deflate  one short socket that offers permessage-deflate, to see whether the server accepts it.
    idle     one socket with no subscription, no client traffic and no protocol pings for up to 150 s, to see whether the server pings or closes a silent socket.

The client sends no WebSocket protocol pings in any mode, so a ping logged is the server's.
Total socket time is about 5 minutes, and the flag --short halves every window for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/ndax/ws-probe.py [--short] [mode ...]
"""

import asyncio
import json
import logging
import statistics
import sys
import time
import urllib.request

import websockets

URL = "wss://api.ndax.io/WSGateway"
REST = "https://api.ndax.io:8443/AP"
SCALE = 0.5 if "--short" in sys.argv else 1.0
BOOK_S = 120 * SCALE
IDLE_S = 150 * SCALE
BOOK_IDS = {1: "BTCCAD", 3: "ETHCAD", 4: "XRPCAD", 74: "BTCUSD", 158: "CCCAD"}


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def trim(raw: str, n: int = 500) -> str:
    return raw if len(raw) <= n else raw[:n] + f"...(+{len(raw) - n} chars)"


def frame(i: int, name: str, payload, m: int = 0) -> str:
    return json.dumps({"m": m, "i": i, "n": name, "o": payload if isinstance(payload, str) else json.dumps(payload)})


async def connect(**kw):
    return await websockets.connect(URL, ping_interval=None, compression=kw.pop("compression", None), max_size=None, **kw)


async def drain(ws, seconds: float, label: str, show: int = 20) -> list:
    got, t_end = [], time.time() + seconds
    while time.time() < t_end:
        try:
            raw = await asyncio.wait_for(ws.recv(), max(0.05, t_end - time.time()))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            out(mode=label, closed=True, code=e.rcvd.code if e.rcvd else None, reason=e.rcvd.reason if e.rcvd else None)
            break
        got.append(raw)
        if len(got) <= show:
            out(mode=label, frame=trim(raw if isinstance(raw, str) else repr(raw)))
    return got


class Book:
    def __init__(self) -> None:
        self.bids: dict[float, float] = {}
        self.asks: dict[float, float] = {}

    def apply(self, row: list) -> None:
        side = self.bids if row[9] == 0 else self.asks
        if row[3] == 2:
            side.pop(row[6], None)
        else:
            side[row[6]] = row[8]

    def top(self, n: int = 20):
        return sorted(self.bids.items(), reverse=True)[:n], sorted(self.asks.items())[:n]


def rest_top(iid: int, depth: int = 20):
    with urllib.request.urlopen(urllib.request.Request(f"{REST}/GetL2Snapshot?OMSId=1&InstrumentId={iid}&Depth={depth}",
                                                       headers={"User-Agent": "arbitrage-observatory-probe/1.0"}), timeout=20) as r:
        rows = json.loads(r.read())
    bids = sorted(((x[6], x[8]) for x in rows if x[9] == 0), reverse=True)
    asks = sorted((x[6], x[8]) for x in rows if x[9] == 1)
    return bids, asks


def snapshot_order(rows: list) -> dict:
    sides = [r[9] for r in rows]
    bp = [r[6] for r in rows if r[9] == 0]
    ap = [r[6] for r in rows if r[9] == 1]
    return {"bids_first": sides == sorted(sides), "bids_desc": bp == sorted(bp, reverse=True), "asks_asc": ap == sorted(ap),
            "repeated_prices": (len(bp) - len(set(bp))) + (len(ap) - len(set(ap)))}


async def mode_book() -> None:
    ws = await connect()
    ext = ws.response.headers.get_all("Sec-WebSocket-Extensions")
    out(mode="book", status=ws.response.status_code, extensions=ext, ray=ws.response.headers.get("CF-RAY"))
    req_ids = {}
    for k, iid in enumerate(BOOK_IDS):
        i = 2 + 2 * k
        req_ids[i] = iid
        await ws.send(frame(i, "SubscribeLevel2", {"OMSId": 1, "InstrumentId": iid, "Depth": 20}))
    books = {iid: Book() for iid in BOOK_IDS}
    last_md = {iid: None for iid in BOOK_IDS}
    gaps = {iid: [] for iid in BOOK_IDS}
    events = {iid: 0 for iid in BOOK_IDS}
    rows_n = {iid: 0 for iid in BOOK_IDS}
    actions = {iid: {} for iid in BOOK_IDS}
    sizes = {iid: [] for iid in BOOK_IDS}
    crossed = {iid: 0 for iid in BOOK_IDS}
    arrivals = {iid: [] for iid in BOOK_IDS}
    lag_ms, delete_age_ms, frame_i, socket_md, other, sizes_bytes = [], [], [], [], [], []
    multi_instr, shown_event, t0 = 0, 0, time.time()
    while time.time() - t0 < BOOK_S:
        try:
            raw = await asyncio.wait_for(ws.recv(), BOOK_S - (time.time() - t0))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            out(mode="book", closed=True, code=e.rcvd.code if e.rcvd else None)
            break
        now = time.time()
        msg = json.loads(raw)
        rows = json.loads(msg["o"]) if isinstance(msg.get("o"), str) and msg["o"].startswith("[") else None
        if msg.get("n") == "SubscribeLevel2" and msg.get("m") == 1:
            iid = req_ids.get(msg["i"])
            b = Book()
            for r in rows:
                b.apply(r)
            books[iid] = b
            last_md[iid] = max(r[0] for r in rows) if rows else None
            mds = [r[0] for r in rows]
            out(mode="book", snapshot=BOOK_IDS[iid], reply_i=msg["i"], after_s=round(now - t0, 3), rows=len(rows),
                bids=len(b.bids), asks=len(b.asks), md_first=mds[:3], md_last=mds[-1:] if mds else None,
                md_contiguous=mds == list(range(mds[0], mds[0] + len(mds))) if mds else None,
                actions=sorted({r[3] for r in rows}), bytes=len(raw), head=trim(raw, 300), **snapshot_order(rows))
            continue
        if msg.get("n") != "Level2UpdateEvent":
            other.append(trim(raw, 300))
            continue
        frame_i.append(msg.get("i"))
        sizes_bytes.append(len(raw))
        if len({r[7] for r in rows}) > 1:
            multi_instr += 1
        for r in rows:
            socket_md.append(r[0])
            iid = r[7]
            if iid not in books:
                continue
            if last_md[iid] is not None and r[0] != last_md[iid] + 1:
                gaps[iid].append((last_md[iid], r[0]))
            last_md[iid] = r[0]
            rows_n[iid] += 1
            actions[iid][r[3]] = actions[iid].get(r[3], 0) + 1
            books[iid].apply(r)
            if r[3] != 2:
                lag_ms.append(now * 1000 - r[2])
            else:
                delete_age_ms.append(now * 1000 - r[2])
        iid = rows[0][7]
        if iid in books:
            events[iid] += 1
            arrivals[iid].append(now)
            b = books[iid]
            sizes[iid].append((len(b.bids), len(b.asks)))
            if b.bids and b.asks and max(b.bids) >= min(b.asks):
                crossed[iid] += 1
        if shown_event < 3:
            shown_event += 1
            out(mode="book", event=trim(raw, 600))
    socket_contig = sum(1 for a, b in zip(socket_md, socket_md[1:]) if b == a + 1)
    out(mode="book", window_s=BOOK_S, event_frames=len(frame_i), frame_i_first=frame_i[:6],
        frame_i_step_counts={d: [b - a for a, b in zip(frame_i, frame_i[1:])].count(d) for d in sorted({b - a for a, b in zip(frame_i, frame_i[1:])})}, frames_with_two_instruments=multi_instr,
        socket_md_pairs_contiguous=f"{socket_contig} of {max(0, len(socket_md) - 1)}",
        bytes_median=statistics.median(sizes_bytes) if sizes_bytes else None, bytes_max=max(sizes_bytes) if sizes_bytes else None,
        other=other[:5])
    if lag_ms:
        lag_ms.sort()
        out(mode="book", arrival_minus_row_time_ms={"median": round(statistics.median(lag_ms)), "p10": round(lag_ms[len(lag_ms) // 10]),
                                                    "p90": round(lag_ms[9 * len(lag_ms) // 10]), "min": round(lag_ms[0])})
    if delete_age_ms:
        delete_age_ms.sort()
        out(mode="book", delete_row_age_ms={"median": round(statistics.median(delete_age_ms)), "max": round(delete_age_ms[-1]),
                                            "over_10s": sum(1 for x in delete_age_ms if x > 10000), "rows": len(delete_age_ms)})
    for iid, sym in BOOK_IDS.items():
        gaps_in = [g[1] - g[0] for g in gaps[iid]]
        iv = [b - a for a, b in zip(arrivals[iid], arrivals[iid][1:])]
        sz = sizes[iid]
        out(mode="book", instrument=sym, events=events[iid], rows=rows_n[iid], actions=actions[iid], md_gaps=len(gaps[iid]),
            md_gap_examples=gaps[iid][:4], md_gap_sizes=sorted(set(gaps_in))[:8],
            bids_min_max=(min(s[0] for s in sz), max(s[0] for s in sz)) if sz else None,
            asks_min_max=(min(s[1] for s in sz), max(s[1] for s in sz)) if sz else None,
            crossed_after_event=crossed[iid],
            interval_median_s=round(statistics.median(iv), 2) if iv else None, interval_max_s=round(max(iv), 1) if iv else None)
    for iid, sym in BOOK_IDS.items():
        kb, ka = books[iid].top(20)
        rb, ra = rest_top(iid)
        same_b = sum(1 for x in kb if x in rb)
        same_a = sum(1 for x in ka if x in ra)
        out(mode="book", compare=sym, kept_bids=len(kb), kept_asks=len(ka), rest_bids=len(rb), rest_asks=len(ra),
            kept_best=(kb[0][0] if kb else None, ka[0][0] if ka else None), rest_best=(rb[0][0] if rb else None, ra[0][0] if ra else None),
            levels_matching_rest=f"{same_b} bids, {same_a} asks",
            kept_beyond_rest_window=f"{len(books[iid].bids)} bids, {len(books[iid].asks)} asks kept in total")
    await ws.close()


async def mode_depth() -> None:
    ws = await connect()
    for k, depth in enumerate((1, 100, 500)):
        await ws.send(frame(2 + 2 * k, "SubscribeLevel2", {"OMSId": 1, "InstrumentId": 1, "Depth": depth}))
        t_end = time.time() + 5 * SCALE + 2
        while time.time() < t_end:
            try:
                msg = json.loads(await asyncio.wait_for(ws.recv(), t_end - time.time()))
            except asyncio.TimeoutError:
                break
            if msg.get("m") in (1, 5):
                o = msg.get("o")
                rows = json.loads(o) if isinstance(o, str) and o.startswith("[") else None
                out(mode="depth", depth=depth, m=msg["m"], i=msg["i"], n=msg["n"],
                    rows=len(rows) if rows is not None else None,
                    bids=sum(1 for r in rows if r[9] == 0) if rows else None, asks=sum(1 for r in rows if r[9] == 1) if rows else None,
                    body=None if rows is not None else trim(o or "", 200))
                break
        await ws.send(frame(20 + 2 * k, "UnsubscribeLevel2", {"OMSId": 1, "InstrumentId": 1}))
        await drain(ws, 1.5, "depth", show=0)
    await ws.close()


async def mode_errors() -> None:
    ws = await connect()
    tests = [
        ("unknown instrument", frame(2, "SubscribeLevel2", {"OMSId": 1, "InstrumentId": 999999, "Depth": 5})),
        ("symbol in place of id", frame(4, "SubscribeLevel2", {"OMSId": 1, "Symbol": "ETHCAD", "Depth": 2})),
        ("first subscribe XRPCAD", frame(6, "SubscribeLevel2", {"OMSId": 1, "InstrumentId": 4, "Depth": 2})),
        ("repeat subscribe XRPCAD", frame(8, "SubscribeLevel2", {"OMSId": 1, "InstrumentId": 4, "Depth": 2})),
        ("unknown function", frame(10, "SubscribeLevel3", {"OMSId": 1, "InstrumentId": 1})),
        ("payload as object", json.dumps({"m": 0, "i": 12, "n": "SubscribeLevel2", "o": {"OMSId": 1, "InstrumentId": 5, "Depth": 2}})),
        ("not JSON", "hello"),
        ("Ping", frame(14, "Ping", {})),
        ("unsubscribe XRPCAD", frame(16, "UnsubscribeLevel2", {"OMSId": 1, "InstrumentId": 4})),
        ("private call", frame(18, "GetOpenOrders", {"OMSId": 1, "AccountId": 1})),
    ]
    for label, f in tests:
        await ws.send(f)
        got = await drain(ws, 2.5, "errors", show=0)
        replies = [g for g in got if '"Level2UpdateEvent"' not in g]
        out(mode="errors", sent=label, frame=trim(f, 200), replies=[trim(g, 300) for g in replies[:3]],
            events=len(got) - len(replies))
    got = await drain(ws, 4 * SCALE + 2, "errors", show=0)
    out(mode="errors", after_unsubscribe_frames=len(got), sample=[trim(g, 200) for g in got[:2]])
    await ws.close()


async def mode_deflate() -> None:
    ws = await connect(compression="deflate")
    out(mode="deflate", status=ws.response.status_code, extensions=ws.response.headers.get_all("Sec-WebSocket-Extensions"))
    await ws.send(frame(2, "Ping", {}))
    await drain(ws, 3, "deflate", show=2)
    await ws.close()


class PingLog(logging.Handler):
    """Collects the times of control frames the websockets library logs at DEBUG, so server pings are visible."""

    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.t0 = time.time()
        self.seen: list = []

    def emit(self, record: logging.LogRecord) -> None:
        text = record.getMessage()
        if "PING" in text or "PONG" in text or "CLOSE" in text:
            self.seen.append((round(time.time() - self.t0, 1), text[:80]))


async def mode_idle() -> None:
    log = logging.getLogger("websockets.client")
    handler = PingLog()
    log.setLevel(logging.DEBUG)
    log.addHandler(handler)
    ws = await connect()
    handler.t0 = t0 = time.time()
    got = []
    while time.time() - t0 < IDLE_S:
        try:
            raw = await asyncio.wait_for(ws.recv(), IDLE_S - (time.time() - t0))
            got.append((round(time.time() - t0, 1), trim(raw, 200)))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            out(mode="idle", closed_after_s=round(time.time() - t0, 1), code=e.rcvd.code if e.rcvd else None,
                reason=e.rcvd.reason if e.rcvd else None, control=handler.seen[:10])
            return
    out(mode="idle", open_after_s=round(time.time() - t0, 1), text_frames=got[:5], control_frames=handler.seen[:10])
    await ws.send(frame(2, "Ping", {}))
    await drain(ws, 3, "idle", show=2)
    await ws.close()
    log.removeHandler(handler)


MODES = {"book": mode_book, "depth": mode_depth, "errors": mode_errors, "deflate": mode_deflate, "idle": mode_idle}

if __name__ == "__main__":
    picked = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    out(start=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked, scale=SCALE)
    for m in picked:
        asyncio.run(MODES[m]())
