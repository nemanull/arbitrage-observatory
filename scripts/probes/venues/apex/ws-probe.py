# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Read-only WebSocket probe for the ApeX Omni public market socket.

Public and unauthenticated. No wallet, no signature, no private channel, no order.
Every mode holds its sockets for at most about three minutes, and all five together for under six.

Run from the repository root:
    uv run scripts/probes/venues/apex/ws-probe.py [book|batch|control|anchor|silence]

Modes:
    book     orderBook200.H on four perps and orderBook25.H on BTC for 40 s: snapshot, level order, the u rule, age, and a REST comparison.
    batch    orderBook25.H on every active perp of /v3/symbols on one socket for 60 s: gaps, cadence, throughput.
    control  acknowledgement shapes, unknown and lowercase symbols, a duplicate subscribe, unsubscribe, ping and pong, deflate, a URL without timestamp.
    anchor   instrumentInfo.all and instrumentInfo.H on three perps for 40 s: fields, cadence and how often index and mark change.
    silence  one socket subscribed to one book that never sends a ping, for up to 170 s.

Captures go to .claude/survey-work/apex/ unless PROBE_OUT_DIR names another folder.
Recorded in docs/profiles/apex/websocket.md.
"""

import asyncio
import json
import os
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from websockets.asyncio.client import connect

BASE = "wss://quote.omni.apex.exchange/realtime_public"
REST = "https://omni.apex.exchange/api"
REPO = Path(__file__).resolve().parents[4]
OUT = Path(os.environ.get("PROBE_OUT_DIR", REPO / ".claude/survey-work/apex"))
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def log(tag, **kw):
    print(json.dumps({"tag": tag, **kw}, default=str), flush=True)


def now_ms():
    return time.time() * 1000


def url(with_ts=True):
    return f"{BASE}?v=2&timestamp={int(now_ms())}" if with_ts else f"{BASE}?v=2"


def stats(xs):
    if not xs:
        return {"n": 0}
    s = sorted(xs)
    pick = lambda q: s[min(len(s) - 1, int(q * len(s)))]
    return {"n": len(s), "min": round(s[0], 3), "p10": round(pick(0.1), 3), "p50": round(statistics.median(s), 3), "p90": round(pick(0.9), 3), "max": round(s[-1], 3)}


def rest(path):
    req = urllib.request.Request(REST + path, headers={"User-Agent": "observatory-probe"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def active_perps():
    cfg = rest("/v3/symbols")["data"]["contractConfig"]
    return [x["crossSymbolName"] for x in cfg["perpetualContract"] if x["enableTrade"]]


def save(name, frames):
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"ws-{name}-{STAMP}.jsonl"
    with path.open("w") as f:
        for fr in frames:
            f.write(json.dumps(fr) + "\n")
    log("saved", path=str(path), frames=len(frames))


class Book:
    """Local book per topic, built from a snapshot and its deltas, with the u rule checked."""

    def __init__(self):
        self.bids, self.asks = {}, {}
        self.u = None
        self.seq = None
        self.snapshots = 0
        self.deltas = 0
        self.gaps = []
        self.seq_back = 0
        self.crossed = 0
        self.one_sided = 0
        self.empty_deltas = 0
        self.zero_deletes_unknown = 0

    def apply(self, kind, data):
        u = data.get("u")
        seq = data.get("seq")
        if kind == "snapshot":
            self.snapshots += 1
            self.bids = {float(p): float(q) for p, q in data.get("b", []) if float(q) > 0}
            self.asks = {float(p): float(q) for p, q in data.get("a", []) if float(q) > 0}
        else:
            self.deltas += 1
            if self.u is not None and u is not None and u != self.u + 1:
                self.gaps.append((self.u, u))
            if not data.get("b") and not data.get("a"):
                self.empty_deltas += 1
            for side, levels in (("b", self.bids), ("a", self.asks)):
                for p, q in data.get(side, []):
                    p, q = float(p), float(q)
                    if q == 0:
                        if p not in levels:
                            self.zero_deletes_unknown += 1
                        levels.pop(p, None)
                    else:
                        levels[p] = q
        if seq is not None and self.seq is not None and seq <= self.seq:
            self.seq_back += 1
        self.u, self.seq = u, seq
        if self.bids and self.asks:
            if max(self.bids) >= min(self.asks):
                self.crossed += 1
        else:
            self.one_sided += 1

    def top(self, n):
        return sorted(self.bids.items(), reverse=True)[:n], sorted(self.asks.items())[:n]


def order_of(levels):
    ps = [float(p) for p, _ in levels]
    if len(ps) < 2:
        return "short"
    if all(a > b for a, b in zip(ps, ps[1:])):
        return "descending"
    if all(a < b for a, b in zip(ps, ps[1:])):
        return "ascending"
    return "unordered"


async def run_books(topics, seconds, chunk, keep_frames, ping=True):
    """Subscribes the topics on one socket and keeps a book per topic for the given seconds."""
    frames = []
    books = defaultdict(Book)
    first_kind = {}
    snap_info = {}
    ages = []
    gaps_ms = defaultdict(list)
    last_arrival = {}
    bytes_in = 0
    n_book = 0
    parse_us = []
    acks = []
    errors = []
    other = Counter()
    sub_at = None
    first_frame_ms = {}
    t_open = time.perf_counter()
    async with connect(url(), compression=None, max_size=None, ping_interval=None, open_timeout=15) as ws:
        open_ms = (time.perf_counter() - t_open) * 1000
        log("open", ms=round(open_ms, 1), headers={k: v for k, v in ws.response.headers.raw_items() if k.lower() in ("server", "sec-websocket-extensions", "x-via", "via", "date")})
        sub_at = now_ms()
        for i in range(0, len(topics), chunk):
            await ws.send(json.dumps({"op": "subscribe", "args": topics[i:i + chunk]}))
        end = time.monotonic() + seconds
        next_ping = time.monotonic() + 15

        async def pinger():
            nonlocal next_ping
            while time.monotonic() < end:
                await asyncio.sleep(1)
                if ping and time.monotonic() >= next_ping:
                    await ws.send(json.dumps({"op": "ping", "args": [str(int(now_ms()))]}))
                    next_ping = time.monotonic() + 15

        ptask = asyncio.create_task(pinger())
        try:
            while True:
                left = end - time.monotonic()
                if left <= 0:
                    break
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                arr = now_ms()
                bytes_in += len(raw)
                t0 = time.perf_counter_ns()
                msg = json.loads(raw)
                parse_us.append((time.perf_counter_ns() - t0) / 1000)
                topic = msg.get("topic", "")
                if topic.startswith("orderBook"):
                    n_book += 1
                    kind = msg.get("type")
                    data = msg.get("data", {})
                    if topic not in first_kind:
                        first_kind[topic] = kind
                        first_frame_ms[topic] = arr - sub_at
                    if kind == "snapshot" and topic not in snap_info:
                        snap_info[topic] = {"bids": len(data.get("b", [])), "asks": len(data.get("a", [])), "bid_order": order_of(data.get("b", [])), "ask_order": order_of(data.get("a", [])), "u": data.get("u"), "seq": data.get("seq"), "keys": sorted(msg.keys()), "data_keys": sorted(data.keys())}
                    books[topic].apply(kind, data)
                    if "ts" in msg:
                        ages.append(arr - msg["ts"] / 1000)
                    if topic in last_arrival:
                        gaps_ms[topic].append(arr - last_arrival[topic])
                    last_arrival[topic] = arr
                    if keep_frames and len(frames) < keep_frames:
                        frames.append({"arr": arr, "msg": msg})
                elif "success" in msg or msg.get("op") in ("pong", "ping"):
                    if len(acks) < 40:
                        acks.append({"arr": arr, "msg": msg})
                    if msg.get("success") is False:
                        errors.append(msg)
                    other[msg.get("op") or msg.get("ret_msg") or "ack"] += 1
                else:
                    other[topic or str(sorted(msg.keys()))] += 1
                    if len(acks) < 40:
                        acks.append({"arr": arr, "msg": msg})
        finally:
            ptask.cancel()
    return {"frames": frames, "books": books, "first_kind": first_kind, "snap_info": snap_info, "ages": ages, "gaps_ms": gaps_ms, "bytes": bytes_in, "n_book": n_book, "parse_us": parse_us, "acks": acks, "errors": errors, "other": other, "first_frame_ms": first_frame_ms, "open_ms": open_ms}


async def mode_book():
    syms = ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "STBLUSDT"]
    topics = [f"orderBook200.H.{s}" for s in syms] + ["orderBook25.H.BTCUSDT", "orderBook25.M.BTCUSDT"]
    r = await run_books(topics, 40, 1, 400)
    rest_cmp = {}
    try:
        t0 = now_ms()
        d = rest("/v3/depth?symbol=BTCUSDT&limit=200")["data"]
        rest_cmp = {"rest_u": d.get("u"), "rest_bids": len(d.get("b", [])), "rest_asks": len(d.get("a", [])), "fetched_ms": round(now_ms() - t0, 1), "rest_bid_order": order_of(d.get("b", [])), "rest_ask_order": order_of(d.get("a", []))}
    except Exception as e:
        rest_cmp = {"error": repr(e)}
    for topic, b in r["books"].items():
        bids, asks = b.top(3)
        log("book", topic=topic, first=r["first_kind"].get(topic), first_frame_ms=round(r["first_frame_ms"].get(topic, -1), 1), snapshots=b.snapshots, deltas=b.deltas, gaps=len(b.gaps), gap_examples=b.gaps[:5], last_u=b.u, last_seq=b.seq, seq_back=b.seq_back, crossed=b.crossed, one_sided=b.one_sided, empty_deltas=b.empty_deltas, zero_deletes_unknown=b.zero_deletes_unknown, levels=(len(b.bids), len(b.asks)), top=(bids, asks), push_gap_ms=stats(r["gaps_ms"].get(topic, [])), snapshot=r["snap_info"].get(topic))
    log("book_summary", open_ms=round(r["open_ms"], 1), book_frames=r["n_book"], ages_ms=stats(r["ages"]), parse_us=stats(r["parse_us"]), other=dict(r["other"]), errors=r["errors"][:5], rest=rest_cmp)
    log("acks", acks=r["acks"][:8])
    save("book", r["acks"] + r["frames"])


async def mode_batch():
    syms = active_perps()
    topics = [f"orderBook25.H.{s}" for s in syms]
    t0 = time.monotonic()
    r = await run_books(topics, 60, 10, 0)
    dur = time.monotonic() - t0
    gaps = sum(len(b.gaps) for b in r["books"].values())
    deltas = sum(b.deltas for b in r["books"].values())
    snaps = sum(b.snapshots for b in r["books"].values())
    no_book = [s for s in syms if f"orderBook25.H.{s}" not in r["books"]]
    first_ms = list(r["first_frame_ms"].values())
    per_topic_rate = {t: round((b.deltas + b.snapshots) / dur, 2) for t, b in r["books"].items()}
    quiet = sorted(per_topic_rate.items(), key=lambda kv: kv[1])[:8]
    busy = sorted(per_topic_rate.items(), key=lambda kv: -kv[1])[:8]
    log("batch", markets=len(syms), topics_with_frames=len(r["books"]), no_frames=no_book, snapshots=snaps, deltas=deltas, gaps=gaps, gap_examples=[(t, b.gaps[:3]) for t, b in r["books"].items() if b.gaps][:5], seq_back=sum(b.seq_back for b in r["books"].values()), crossed=sum(b.crossed for b in r["books"].values()), one_sided_topics=[t for t, b in r["books"].items() if b.one_sided], empty_deltas=sum(b.empty_deltas for b in r["books"].values()), frames_per_s=round(r["n_book"] / dur, 1), kib_per_s=round(r["bytes"] / 1024 / dur, 1), bytes_per_frame=round(r["bytes"] / max(1, r["n_book"]), 1), parse_us=stats(r["parse_us"]), first_frame_ms=stats(first_ms), ages_ms=stats(r["ages"]), quietest=quiet, busiest=busy, errors=r["errors"][:5], other=dict(r["other"]))
    log("acks", acks=r["acks"][:12])


async def recv_for(ws, seconds, sink):
    end = time.monotonic() + seconds
    while True:
        left = end - time.monotonic()
        if left <= 0:
            return
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return
        msg = json.loads(raw)
        if isinstance(msg, dict) and msg.get("topic", "").startswith("orderBook") and msg.get("type") == "delta":
            sink.append({"arr": now_ms(), "delta_of": msg["topic"]})
            continue
        sink.append({"arr": now_ms(), "msg": msg if len(raw) < 3000 else {"trimmed": raw[:600]}})


async def mode_control():
    cases = {}
    async with connect(url(), compression=None, max_size=None, ping_interval=None, open_timeout=15) as ws:
        for name, frame in [
            ("subscribe_ok", {"op": "subscribe", "args": ["orderBook25.H.BTCUSDT"]}),
            ("duplicate", {"op": "subscribe", "args": ["orderBook25.H.BTCUSDT"]}),
            ("unknown_symbol", {"op": "subscribe", "args": ["orderBook25.H.NOPEUSDT"]}),
            ("lowercase_symbol", {"op": "subscribe", "args": ["orderBook25.H.ethusdt"]}),
            ("dash_symbol", {"op": "subscribe", "args": ["orderBook25.H.ETH-USDT"]}),
            ("bad_depth", {"op": "subscribe", "args": ["orderBook50.H.ETHUSDT"]}),
            ("inactive_perp", {"op": "subscribe", "args": ["orderBook25.H.MATICUSDT"]}),
            ("stock_perp", {"op": "subscribe", "args": ["orderBook25.H.AAPLUSDT"]}),
            ("mixed_frame", {"op": "subscribe", "args": ["orderBook25.H.NOPE2USDT", "orderBook25.H.SOLUSDT"]}),
            ("invalid_op", {"op": "nope", "args": []}),
            ("ping", {"op": "ping", "args": [str(int(now_ms()))]}),
            ("ping_no_args", {"op": "ping"}),
            ("unsubscribe", {"op": "unsubscribe", "args": ["orderBook25.H.BTCUSDT"]}),
            ("not_json", "hello"),
        ]:
            sink = []
            sent = now_ms()
            await ws.send(frame if isinstance(frame, str) else json.dumps(frame))
            await recv_for(ws, 2.5, sink)
            deltas = sum(1 for x in sink if "delta_of" in x)
            kept = [dict(x, after_ms=round(x["arr"] - sent, 1)) for x in sink if "msg" in x][:6]
            cases[name] = {"sent": frame, "replies": kept, "deltas": deltas, "open": ws.state.name}
            log("control", case=name, **cases[name])
            if ws.state.name != "OPEN":
                break
    for name, kwargs in [("deflate", {"compression": "deflate"}), ("no_timestamp", {"compression": None})]:
        try:
            u = url(with_ts=(name != "no_timestamp"))
            async with connect(u, max_size=None, ping_interval=None, open_timeout=15, **kwargs) as ws:
                ext = ws.response.headers.get("sec-websocket-extensions")
                await ws.send(json.dumps({"op": "subscribe", "args": ["orderBook25.H.BTCUSDT"]}))
                sink = []
                await recv_for(ws, 3, sink)
                log("control", case=name, url=u, extensions=ext, frames=len(sink), first=[x for x in sink if "msg" in x][:2])
        except Exception as e:
            log("control", case=name, error=repr(e))
    save("control", [{"case": k, **v} for k, v in cases.items()])


def judge_all(frames, active):
    """Reads the instrumentInfo.all frames for the active perps: status, zero fields, mark against index, and change counts."""
    snaps = [{x["s"]: x for x in f["data"]} for f in frames if isinstance(f.get("data"), list)]
    if not snaps:
        return {}
    last = snaps[-1]
    rows = {s: last.get(s) for s in active}
    present = {s: x for s, x in rows.items() if x}
    ss = Counter(x.get("ss") for x in present.values())
    ss_other = Counter(x.get("ss") for s, x in last.items() if s not in active)
    eq = sorted(s for s, x in present.items() if x.get("mp") == x.get("xp"))
    empty = Counter(k for x in present.values() for k in ("mp", "xp", "fr") if x.get(k) in ("", "0", None))
    ppm = sorted(abs(float(x["mp"]) / float(x["xp"]) - 1) * 1e6 for x in present.values() if x.get("xp") not in ("", "0", None) and x.get("mp") not in ("", "0", None))
    changes = {k: Counter() for k in ("mp", "xp", "fr")}
    moves = []
    for a, b in zip(snaps, snaps[1:]):
        for s in active:
            xa, xb = a.get(s), b.get(s)
            if not xa or not xb:
                continue
            for k in ("mp", "xp", "fr"):
                if xa.get(k) != xb.get(k):
                    changes[k][s] += 1
            for k in ("mp", "xp"):
                va, vb = float(xa.get(k) or 0), float(xb.get(k) or 0)
                if va > 0 and vb > 0:
                    moves.append(abs(vb / va - 1) * 1e6)
    worst = max(present.items(), key=lambda kv: abs(float(kv[1]["mp"]) / float(kv[1]["xp"]) - 1) if kv[1].get("xp") not in ("", "0", None) else 0)
    return {"frames": len(snaps), "rows_last": len(last), "active_present": len(present), "active_missing": sorted(s for s, x in rows.items() if not x), "ss_active": dict(ss), "ss_other": dict(ss_other), "ss_by_symbol": {s: present[s].get("ss") for s in ("BTCUSDT", "IOUSDT", "STBLUSDT") if s in present}, "mark_equals_index": len(eq), "mark_equals_index_names": eq, "empty_fields": dict(empty), "mark_index_ppm": stats(ppm), "widest": (worst[0], worst[1].get("mp"), worst[1].get("xp")), "fr_values": Counter(x.get("fr") for x in present.values()).most_common(4), "changes_per_symbol": {k: stats([changes[k][s] for s in present]) for k in changes}, "never_changed": {k: len([s for s in present if changes[k][s] == 0]) for k in changes}, "moves_over_1000ppm": sum(1 for m in moves if m > 1000), "moves": len(moves)}


async def mode_anchor():
    active = set(active_perps())
    syms = ["BTCUSDT", "ETHUSDT", "STBLUSDT"]
    topics = ["instrumentInfo.all"] + [f"instrumentInfo.H.{s}" for s in syms]
    frames = []
    per = defaultdict(list)
    last_all = None
    async with connect(url(), compression=None, max_size=None, ping_interval=None, open_timeout=15) as ws:
        await ws.send(json.dumps({"op": "subscribe", "args": topics}))
        end = time.monotonic() + 40
        next_ping = time.monotonic() + 15
        while True:
            left = end - time.monotonic()
            if left <= 0:
                break
            if time.monotonic() >= next_ping:
                await ws.send(json.dumps({"op": "ping", "args": [str(int(now_ms()))]}))
                next_ping = time.monotonic() + 15
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=min(left, 1))
            except asyncio.TimeoutError:
                continue
            arr = now_ms()
            msg = json.loads(raw)
            topic = msg.get("topic", msg.get("op", "ack"))
            per[topic].append({"arr": arr, "ts": msg.get("ts"), "type": msg.get("type"), "bytes": len(raw), "data": msg.get("data")})
            if topic == "instrumentInfo.all":
                last_all = raw
            if len(frames) < 60:
                frames.append({"arr": arr, "msg": msg if len(raw) < 4000 else {"trimmed": raw[:1500]}})
    for topic, rows in per.items():
        arrs = [r["arr"] for r in rows]
        gaps = [b - a for a, b in zip(arrs, arrs[1:])]
        ages = [r["arr"] - r["ts"] / 1000 for r in rows if isinstance(r["ts"], (int, float))]
        types = Counter(r["type"] for r in rows)
        info = {"frames": len(rows), "types": dict(types), "gap_ms": stats(gaps), "age_ms": stats(ages), "bytes": stats([r["bytes"] for r in rows])}
        if topic == "instrumentInfo.all":
            counts = [len(r["data"]) for r in rows if isinstance(r["data"], list)]
            keys = Counter(k for r in rows if isinstance(r["data"], list) for x in r["data"] for k in x)
            info.update(rows_per_frame=stats(counts), keys=dict(keys))
            seen = defaultdict(list)
            for r in rows:
                if isinstance(r["data"], list):
                    for x in r["data"]:
                        seen[x.get("s")].append((r["arr"], x))
            info["symbols_seen"] = len(seen)
            info["active"] = judge_all(rows, active)
            for s in syms:
                xs = seen.get(s, [])
                fields = Counter(k for _, x in xs for k in x)
                arr_s = [a for a, _ in xs]
                info[f"{s}_updates"] = {"n": len(xs), "gap_ms": stats([b - a for a, b in zip(arr_s, arr_s[1:])]), "fields": dict(fields), "mp_values": len({x.get("mp") for _, x in xs if "mp" in x}), "xp_values": len({x.get("xp") for _, x in xs if "xp" in x})}
        elif topic.startswith("instrumentInfo.H"):
            keys = Counter(k for r in rows if isinstance(r["data"], dict) for k in r["data"])
            info["keys"] = dict(keys)
            for f in ("markPrice", "indexPrice", "oraclePrice", "fundingRate", "predictedFundingRate", "nextFundingTime"):
                vals = [r["data"].get(f) for r in rows if isinstance(r["data"], dict) and f in r["data"]]
                info[f] = {"present": len(vals), "distinct": len(set(vals)), "last": vals[-1] if vals else None}
        log("anchor", topic=topic, **info)
    save("anchor", frames)
    if last_all:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / f"ws-anchor-all-{STAMP}.json").write_text(last_all)


async def mode_silence():
    events = []
    t0 = time.monotonic()
    close = None
    try:
        async with connect(url(), compression=None, max_size=None, ping_interval=None, open_timeout=15) as ws:
            await ws.send(json.dumps({"op": "subscribe", "args": ["orderBook25.H.BTCUSDT"]}))
            n = 0
            while time.monotonic() - t0 < 170:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    continue
                n += 1
                msg = json.loads(raw)
                if not msg.get("topic", "").startswith("orderBook"):
                    events.append({"t_s": round(time.monotonic() - t0, 1), "msg": msg})
                    log("silence_frame", t_s=round(time.monotonic() - t0, 1), msg=msg)
            close = "held to the 170 s cap"
    except Exception as e:
        close = repr(e)
    log("silence", seconds=round(time.monotonic() - t0, 1), close=close, non_book_frames=len(events))
    save("silence", events)


MODES = {"book": mode_book, "batch": mode_batch, "control": mode_control, "anchor": mode_anchor, "silence": mode_silence}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "book"
    log("start", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    asyncio.run(MODES[mode]())
    log("end", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
