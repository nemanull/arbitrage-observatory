# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of the Hibachi public market socket, wss://data-api.hibachi.xyz/ws/market.

Modes: hosts (about 3 s), book (--seconds on one socket, 40 by default, plus about 6 s on a second), depth (about 17 s),
anchors (up to 30 s, with the REST inventory polled beside it), errors (about 40 s on short sockets),
silence (66 s on three sockets at once), and all of them in turn by default.
Run from the repository root: uv run scripts/probes/venues/hibachi/ws-probe.py [mode ...] [--seconds N]
Captures go to .claude/survey-work/hibachi/.
No credentials are used, nothing is signed, and the private /ws/trade and /ws/account sockets are never opened.
"""

import asyncio
import json
import logging
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/hibachi")
URL = "wss://data-api.hibachi.xyz/ws/market"
REST = "https://data-api.hibachi.xyz"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
SECONDS = 40.0


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def pct(xs, p):
    if not xs:
        return float("nan")
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p * (len(xs) - 1))))]


def live_symbols() -> list[str]:
    req = urllib.request.Request(REST + "/market/exchange-info", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.loads(r.read())
    return [c["symbol"] for c in d["futureContracts"] if c["status"] == "LIVE"]


def sub_frame(subs: list[dict], method: str = "subscribe") -> str:
    return json.dumps({"method": method, "parameters": {"subscriptions": subs}})


class PingCounter(logging.Handler):
    """Counts the protocol frames the websockets library logs at debug level."""

    def __init__(self):
        super().__init__(logging.DEBUG)
        self.counts = Counter()
        self.first = {}

    def emit(self, record):
        msg = record.getMessage()
        for kind in ("< PING", "> PONG", "> PING", "< PONG", "< CLOSE", "> CLOSE"):
            if msg.startswith(kind):
                self.counts[kind] += 1
                self.first.setdefault(kind, time.time())


def attach_ping_counter() -> PingCounter:
    h = PingCounter()
    lg = logging.getLogger("websockets.client")
    lg.setLevel(logging.DEBUG)
    lg.addHandler(h)
    lg.propagate = False
    return h


async def connect(url: str = URL, deflate: bool = False):
    return await websockets.connect(
        url,
        compression="deflate" if deflate else None,
        ping_interval=None,
        max_size=None,
        open_timeout=15,
        user_agent_header=UA,
    )


async def mode_hosts() -> None:
    for label, url, deflate in (
        ("plain", URL, False),
        ("deflate offered", URL, True),
        ("sdk query string", URL + "?hibachiClient=HibachiPythonSDK/0.3.2", False),
    ):
        t0 = time.perf_counter()
        ws = await connect(url, deflate)
        ms = (time.perf_counter() - t0) * 1000
        h = ws.response.headers
        print(f"[hosts] {now()} {label}: status {ws.response.status_code} open {ms:.0f} ms server={h.get('Server')} cf-ray={h.get('CF-Ray')} sec-websocket-extensions={h.get('Sec-WebSocket-Extensions')}")
        await ws.close()
        await asyncio.sleep(0.3)


class Book:
    def __init__(self):
        self.bids: dict[str, float] = {}
        self.asks: dict[str, float] = {}

    def apply(self, side_levels: dict, side: str, replace: bool) -> int:
        book = self.bids if side == "bid" else self.asks
        if replace:
            book.clear()
        deletes = 0
        for lv in side_levels.get("levels", []):
            q = float(lv["quantity"])
            if q == 0:
                deletes += 1
                book.pop(lv["price"], None)
            else:
                book[lv["price"]] = q
        return deletes

    def sorted_bids(self):
        return sorted(((float(p), q) for p, q in self.bids.items()), reverse=True)

    def sorted_asks(self):
        return sorted((float(p), q) for p, q in self.asks.items())


def check_window(book: Book, data: dict, depth: int) -> list[str]:
    issues = []
    for side, levels in (("bid", book.sorted_bids()), ("ask", book.sorted_asks())):
        meta = data[side]
        if len(levels) > depth:
            issues.append(f"{side}_deeper_than_depth")
        if levels:
            if meta.get("startPrice") is None or float(meta["startPrice"]) != levels[0][0]:
                issues.append(f"{side}_start_mismatch")
            if meta.get("endPrice") is None or float(meta["endPrice"]) != levels[-1][0]:
                issues.append(f"{side}_end_mismatch")
        elif meta.get("startPrice") is not None:
            issues.append(f"{side}_empty_but_start_{meta.get('startPrice')}")
    bb, ba = book.sorted_bids(), book.sorted_asks()
    if bb and ba and bb[0][0] >= ba[0][0]:
        issues.append("crossed")
    return issues


async def mode_book(seconds: float) -> None:
    syms = live_symbols()
    pings = attach_ping_counter()
    ws = await connect()
    t_open = time.time()
    await ws.send(sub_frame([{"symbol": s, "topic": "orderbook"} for s in syms]))
    books = {s: Book() for s in syms}
    stats = defaultdict(Counter)
    ts_last = {}
    steps = defaultdict(list)
    ages = []
    first_snapshot_ms = {}
    parse_us = []
    sizes = []
    issues_seen = Counter()
    issue_examples = []
    history = defaultdict(dict)  # symbol to timestamp_ms to (bids, asks), for the second socket's snapshots
    clock = defaultdict(set)  # timestamp_ms to symbols, for the push clock
    level_counts = defaultdict(list)
    one_sided = Counter()
    other = Counter()
    b_snaps = []
    keys_seen = set()
    captured = {}  # the first BTC snapshot, update and empty update, levels cut to three a side

    async def second_socket():
        await asyncio.sleep(seconds / 2)
        ws2 = await connect()
        await ws2.send(sub_frame([{"symbol": s, "topic": "orderbook"} for s in syms]))
        got = set()
        end = time.time() + 6
        while time.time() < end and len(got) < len(syms):
            try:
                raw = await asyncio.wait_for(ws2.recv(), timeout=end - time.time())
            except asyncio.TimeoutError:
                break
            m = json.loads(raw)
            if m.get("messageType") == "Snapshot" and m["symbol"] not in got:
                got.add(m["symbol"])
                bb = Book()
                bb.apply(m["data"]["bid"], "bid", True)
                bb.apply(m["data"]["ask"], "ask", True)
                b_snaps.append((m["symbol"], m["timestamp_ms"], bb.sorted_bids(), bb.sorted_asks()))
        await ws2.close()

    task = asyncio.create_task(second_socket())
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
        except asyncio.TimeoutError:
            break
        t_recv = time.time()
        p0 = time.perf_counter()
        m = json.loads(raw)
        parse_us.append((time.perf_counter() - p0) * 1e6)
        sizes.append(len(raw))
        if m.get("topic") != "orderbook":
            other[raw[:120]] += 1
            continue
        if m["symbol"] == "BTC/USDT-P":
            n_lv = len(m["data"]["bid"]["levels"]) + len(m["data"]["ask"]["levels"])
            kind = "snapshot" if m["messageType"] == "Snapshot" else ("empty_update" if n_lv == 0 else "update")
            if kind not in captured:
                trimmed = json.loads(raw)
                for side in ("bid", "ask"):
                    trimmed["data"][side]["levels"] = trimmed["data"][side]["levels"][:3]
                captured[kind] = trimmed
        keys_seen |= set(m)
        s = m["symbol"]
        mt = m["messageType"]
        ts = m["timestamp_ms"]
        depth = m.get("depth")
        stats[s][mt] += 1
        ages.append(t_recv * 1000 - ts)
        clock[ts].add(s)
        if s in ts_last:
            steps[s].append(ts - ts_last[s])
            if ts <= ts_last[s]:
                stats[s]["ts_not_rising"] += 1
        ts_last[s] = ts
        replace = mt == "Snapshot"
        if replace:
            first_snapshot_ms.setdefault(s, (t_recv - t_open) * 1000)
            if stats[s]["Snapshot"] > 1:
                stats[s]["extra_snapshot"] += 1
        elif stats[s]["Snapshot"] == 0:
            stats[s]["update_before_snapshot"] += 1
        n_changes = len(m["data"]["bid"].get("levels", [])) + len(m["data"]["ask"].get("levels", []))
        if mt == "Update" and n_changes == 0:
            stats[s]["empty_update"] += 1
        dels = books[s].apply(m["data"]["bid"], "bid", replace) + books[s].apply(m["data"]["ask"], "ask", replace)
        stats[s]["deletes"] += dels
        found = check_window(books[s], m["data"], depth)
        for f in found:
            issues_seen[f] += 1
            if len(issue_examples) < 5:
                issue_examples.append((s, mt, ts, f, json.dumps(m)[:600]))
        bb, ba = books[s].sorted_bids(), books[s].sorted_asks()
        level_counts[s].append((len(bb), len(ba)))
        if not bb or not ba:
            one_sided[s] += 1
        history[s][ts] = (bb, ba)
    await task
    await ws.close()
    dur = seconds
    total = sum(sum(c[k] for k in ("Snapshot", "Update")) for c in stats.values())
    print(f"[book] {now()} {len(syms)} markets on one socket for {dur:.0f} s: {total} book frames, {total / dur:.1f} a second, {sum(sizes) / dur / 1024:.1f} KiB a second, bytes a frame p50 {statistics.median(sizes):.0f} max {max(sizes)}")
    print(f"[book] frame keys {sorted(keys_seen)}, non-book frames {dict(other)}")
    print(f"[book] json.loads per frame p50 {statistics.median(parse_us):.1f} us p99 {pct(parse_us, 0.99):.1f} us")
    print(f"[book] first snapshot after the subscribe frame, ms: min {min(first_snapshot_ms.values()):.0f} max {max(first_snapshot_ms.values()):.0f}")
    all_steps = [x for v in steps.values() for x in v]
    print(f"[book] timestamp_ms step between frames of one market: p10 {pct(all_steps, 0.1)} p50 {pct(all_steps, 0.5)} p90 {pct(all_steps, 0.9)} max {max(all_steps)} ms")
    print(f"[book] arrival minus timestamp_ms: min {min(ages):.0f} p50 {statistics.median(ages):.0f} p90 {pct(ages, 0.9):.0f} max {max(ages):.0f} ms")
    shared = Counter(len(v) for v in clock.values())
    print(f"[book] markets sharing one timestamp_ms: {dict(sorted(shared.items()))} over {len(clock)} distinct values")
    for s in syms:
        c = stats[s]
        lc = level_counts[s]
        nb = [x[0] for x in lc]
        na = [x[1] for x in lc]
        print(
            f"[book]   {s:<12} snap {c['Snapshot']} upd {c['Update']} empty {c['empty_update']} deletes {c['deletes']} extra_snap {c['extra_snapshot']} "
            f"upd_before_snap {c['update_before_snapshot']} ts_not_rising {c['ts_not_rising']} bids min/max {min(nb) if nb else '-'}/{max(nb) if nb else '-'} "
            f"asks min/max {min(na) if na else '-'}/{max(na) if na else '-'} one_sided_frames {one_sided[s]} step p50 {pct(steps[s], 0.5)}"
        )
    print(f"[book] window and cross checks after every frame: {dict(issues_seen) if issues_seen else 'none failed'}")
    for ex in issue_examples:
        print(f"[book]   example {ex}")
    match, mismatch, absent = 0, 0, 0
    for s, ts, bb, ba in b_snaps:
        h = history[s].get(ts)
        if h is None:
            absent += 1
            continue
        if h[0] == bb and h[1] == ba:
            match += 1
        else:
            mismatch += 1
            print(f"[book]   second socket snapshot differs for {s} at {ts}: rebuilt top {h[0][:2]} {h[1][:2]} snapshot top {bb[:2]} {ba[:2]}")
    print(f"[book] second socket snapshots against the book rebuilt from deltas at the same timestamp_ms: {match} identical, {mismatch} different, {absent} with no frame of that timestamp on the first socket")
    print(f"[book] protocol frames logged by the client: {dict(pings.counts)}")
    snap = {s: {"bids": books[s].sorted_bids()[:3], "asks": books[s].sorted_asks()[:3]} for s in syms}
    (WORK / "ws-book-tops.json").write_text(json.dumps(snap, indent=1))
    (WORK / "ws-book-frames.json").write_text(json.dumps(captured, indent=1))
    for kind, frame in captured.items():
        print(f"[book] captured {kind}: {json.dumps(frame, separators=(',', ':'))}")


async def mode_depth() -> None:
    for depth, gran in ((1, None), (20, None), (50, None), (100, None), (101, None), (20, "10")):
        sub = {"symbol": "BTC/USDT-P", "topic": "orderbook", "depth": depth}
        if gran:
            sub["granularity"] = gran
        ws = await connect()
        await ws.send(sub_frame([sub]))
        frames = []
        end = time.time() + 2.0
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
            except asyncio.TimeoutError:
                break
            frames.append(json.loads(raw))
        await ws.close()
        first = frames[0] if frames else {}
        if "data" in first:
            d = first["data"]
            print(f"[depth] {now()} BTC depth {depth} granularity {gran}: {len(frames)} frames in 2 s, first {first['messageType']} depth={first.get('depth')} granularity={first.get('granularity')} bids {len(d['bid']['levels'])} asks {len(d['ask']['levels'])}")
        else:
            print(f"[depth] {now()} BTC depth {depth} granularity {gran}: {len(frames)} frames, first {json.dumps(first)[:300]}")
        await asyncio.sleep(0.3)


def poll_inventory(seconds: float, out: list) -> None:
    """Polls the REST bulk anchor once a second beside the socket, keeping each reply's arrival time."""
    end = time.time() + seconds
    while time.time() < end:
        t_send = time.time()
        req = urllib.request.Request(REST + "/market/inventory", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read())
        t_recv = time.time()
        out.append((t_recv, {m["contract"]["symbol"]: (m["info"].get("markPrice"), m["info"].get("spotPrice")) for m in d["markets"] if m["contract"]["status"] == "LIVE"}))
        time.sleep(max(0.0, 1.0 - (time.time() - t_send)))


def rest_lag(polls: list, stream: dict, field: int) -> tuple[Counter, list]:
    """For each poll, how many socket values behind the REST value was, and for how long it had been superseded."""
    behind = Counter()
    lags = []
    for t_poll, row in polls:
        for s, vals in row.items():
            seq = [(t, v) for t, v in stream.get(s, []) if t <= t_poll]
            if not seq:
                continue
            # The distinct values in arrival order, each with the arrival of its first frame.
            runs = []
            for t, v in seq:
                if not runs or runs[-1][1] != v:
                    runs.append((t, v))
            hit = None
            for k in range(len(runs) - 1, -1, -1):
                if runs[k][1] == vals[field]:
                    hit = len(runs) - 1 - k
                    if hit > 0:
                        lags.append((t_poll - runs[k + 1][0]) * 1000)
                    break
            behind[hit if hit is not None and hit < 5 else ("none" if hit is None else "5+")] += 1
    return behind, lags


async def mode_anchors(seconds: float) -> None:
    syms = live_symbols()
    topics = ["mark_price", "spot_price", "funding_rate_estimation", "ask_bid_price"]
    ws = await connect()
    await ws.send(sub_frame([{"symbol": s, "topic": t} for s in syms for t in topics]))
    polls: list = []
    marks_seen = defaultdict(list)
    spots_seen = defaultdict(list)
    poller = asyncio.get_running_loop().run_in_executor(None, poll_inventory, seconds - 2, polls)
    last = {}
    count = Counter()
    changes = Counter()
    gaps = defaultdict(list)
    t_last = {}
    examples = {}
    keys = defaultdict(set)
    ages = []
    end = time.time() + seconds
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
        except asyncio.TimeoutError:
            break
        t = time.time()
        m = json.loads(raw)
        k = (m.get("symbol"), m.get("topic"))
        count[k] += 1
        keys[m.get("topic")] |= set(m.get("data", {}))
        examples.setdefault(m.get("topic"), raw)
        val = json.dumps(m.get("data"), sort_keys=True)
        if k in last and last[k] != val:
            changes[k] += 1
        last[k] = val
        if k in t_last:
            gaps[m.get("topic")].append((t - t_last[k]) * 1000)
        t_last[k] = t
        if m.get("topic") == "ask_bid_price" and m["data"].get("timestampMs"):
            ages.append(t * 1000 - m["data"]["timestampMs"])
        if m.get("topic") == "mark_price":
            marks_seen[m["symbol"]].append((t, m["data"]["markPrice"]))
        if m.get("topic") == "spot_price":
            spots_seen[m["symbol"]].append((t, m["data"]["spotPrice"]))
    await ws.close()
    await poller
    for label, stream, field in (("mark", marks_seen, 0), ("spot", spots_seen, 1)):
        behind, lags = rest_lag(polls, stream, field)
        lag_txt = f"superseded for p50 {pct(lags, 0.5):.0f} p90 {pct(lags, 0.9):.0f} max {max(lags):.0f} ms" if lags else "never superseded"
        print(f"[anchors] REST /market/inventory {label} against the socket over {len(polls)} polls: socket values behind {dict(behind)}, a stale REST value had been {lag_txt}")
    print(f"[anchors] {now()} {len(syms)} markets x {len(topics)} topics = {len(syms) * len(topics)} subscriptions on one socket for {seconds:.0f} s")
    for tp in topics:
        g = gaps[tp]
        n = sum(v for (s, t), v in count.items() if t == tp)
        ch = sum(v for (s, t), v in changes.items() if t == tp)
        print(f"[anchors]   {tp:<24} frames {n} ({n / seconds / len(syms):.2f} a second per market), changed {ch}, gap p50 {pct(g, 0.5):.0f} p90 {pct(g, 0.9):.0f} max {max(g) if g else float('nan'):.0f} ms, data keys {sorted(keys[tp])}")
        print(f"[anchors]     example {examples.get(tp, '')[:300]}")
    for s in syms:
        row = " ".join(f"{t.split('_')[0]} {count[(s, t)]}/{changes[(s, t)]}" for t in topics)
        print(f"[anchors]   {s:<12} frames/changes: {row}")
    if ages:
        print(f"[anchors] ask_bid_price arrival minus timestampMs: p50 {statistics.median(ages):.0f} max {max(ages):.0f} ms")


async def one_case(name: str, frames: list[str], listen: float = 3.0) -> None:
    """Sends each frame in turn and listens after each, so every received frame is tagged with the phase it arrived in."""
    t0 = time.time()
    try:
        ws = await connect()
        out = []
        for phase, f in enumerate(frames, 1):
            await ws.send(f)
            end = time.time() + listen
            while time.time() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
                except asyncio.TimeoutError:
                    break
                m = json.loads(raw)
                if "error" in m:
                    out.append((phase, "error", round((time.time() - t0) * 1000), raw[:260]))
                else:
                    out.append((phase, m.get("topic"), m.get("symbol"), m.get("messageType")))
        summary = Counter(o if o[1] != "error" else (o[0], "error") for o in out)
        errors = [o for o in out if o[1] == "error"]
        print(f"[errors] {now()} {name}: frames by (phase, topic, symbol, type) {dict(summary)} state {ws.state.name}")
        for e in errors[:3]:
            print(f"[errors]     phase {e[0]} at {e[2]} ms {e[3]}")
        await ws.close()
    except websockets.ConnectionClosed as e:
        print(f"[errors] {name}: closed after {(time.time() - t0) * 1000:.0f} ms code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None}")


async def mode_errors() -> None:
    ob = lambda s, **kw: {"symbol": s, "topic": "orderbook", **kw}
    cases = [
        ("unknown symbol", [sub_frame([ob("FOO/USDT-P")])]),
        ("closed symbol DOGE", [sub_frame([ob("DOGE/USDT-P")])]),
        ("lowercase symbol", [sub_frame([ob("btc/usdt-p")])]),
        ("unknown topic", [sub_frame([{"symbol": "BTC/USDT-P", "topic": "depth"}])]),
        ("granularity as a number", [sub_frame([ob("BTC/USDT-P", granularity=0.1)])]),
        ("granularity not listed", [sub_frame([ob("BTC/USDT-P", granularity="0.5")])]),
        ("malformed json", ["{not json"]),
        ("unknown method ping", [json.dumps({"method": "ping"})]),
        ("batch of a good and an unknown symbol", [sub_frame([ob("SOL/USDT-P"), ob("FOO/USDT-P")])]),
        ("batch of a good and a closed symbol", [sub_frame([ob("SOL/USDT-P"), ob("DOGE/USDT-P")])]),
        ("same market subscribed twice", [sub_frame([ob("SOL/USDT-P")]), sub_frame([ob("SOL/USDT-P")])]),
        ("unsubscribe then subscribe again", [sub_frame([ob("SOL/USDT-P")]), sub_frame([ob("SOL/USDT-P")], "unsubscribe"), sub_frame([ob("SOL/USDT-P")])]),
        ("unsubscribe a market never subscribed", [sub_frame([ob("ETH/USDT-P")], "unsubscribe")]),
    ]
    for name, frames in cases:
        await one_case(name, frames, listen=2.0)
        await asyncio.sleep(0.3)


async def silent_socket(label: str, seconds: float, subscribe: str | None, ping_every: float | None) -> None:
    """Holds one socket that sends nothing, or only a subscribe frame, or only protocol pings, and reports when it closed."""
    t0 = time.time()
    ws = await connect()
    frames = 0
    pongs = []
    if subscribe:
        await ws.send(sub_frame([{"symbol": subscribe, "topic": "orderbook"}]))

    async def pinger():
        while True:
            await asyncio.sleep(ping_every)
            t = time.perf_counter()
            waiter = await ws.ping()
            await waiter
            pongs.append((time.perf_counter() - t) * 1000)

    ptask = asyncio.create_task(pinger()) if ping_every else None
    closed = None
    try:
        while time.time() - t0 < seconds:
            await asyncio.wait_for(ws.recv(), timeout=seconds - (time.time() - t0))
            frames += 1
    except asyncio.TimeoutError:
        pass
    except websockets.ConnectionClosed:
        closed = time.time() - t0
    if ptask:
        ptask.cancel()
    code, reason = ws.close_code, ws.close_reason
    await ws.close()
    pong_txt = f", pongs {len(pongs)} in {[round(p) for p in pongs]} ms" if ping_every else ""
    if closed is None:
        print(f"[silence] {now()} {label}: open for the whole {seconds:.0f} s, {frames} frames received{pong_txt}")
    else:
        print(f"[silence] {now()} {label}: closed after {closed:.1f} s, code {code} reason {reason!r}, {frames} frames received{pong_txt}")


async def mode_silence(seconds: float = 66.0) -> None:
    pings = attach_ping_counter()
    await asyncio.gather(
        silent_socket("A, no subscription, sends nothing", seconds, None, None),
        silent_socket("B, one book subscription (CAD/USDT-P), then sends nothing", seconds, "CAD/USDT-P", None),
        silent_socket("C, no subscription, a protocol ping every 20 s", seconds, None, 20.0),
    )
    print(f"[silence] protocol frames logged by the client across the three sockets: {dict(pings.counts)}")


async def main(argv: list[str]) -> None:
    global SECONDS
    args = [a for a in argv if not a.startswith("--")]
    if "--seconds" in argv:
        SECONDS = float(argv[argv.index("--seconds") + 1])
        args = [a for a in args if a != argv[argv.index("--seconds") + 1]]
    modes = args or ["hosts", "book", "depth", "anchors", "errors", "silence"]
    for mname in modes:
        if mname == "hosts":
            await mode_hosts()
        elif mname == "book":
            await mode_book(SECONDS)
        elif mname == "depth":
            await mode_depth()
        elif mname == "anchors":
            await mode_anchors(min(SECONDS, 30.0))
        elif mname == "errors":
            await mode_errors()
        elif mname == "silence":
            await mode_silence()


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    asyncio.run(main(sys.argv[1:]))
