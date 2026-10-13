# /// script
# requires-python = ">=3.11"
# dependencies = ["websocket-client>=1.8,<2", "websockets>=13,<16"]
# ///
"""Lighter WebSocket probe for docs/profiles/lighter/websocket.md and the socket anchor in rest.md.

Public, unauthenticated and read-only: market channels only, no account channel, no auth token, no sendtx.
The documented per IP limits are 200 client messages a minute and 500 subscriptions a connection,
so subscribe frames are paced at least SUB_GAP_S apart, which stays near 60 % of the message budget.
websocket-client is driven frame by frame with recv_frame, so the probe sees every protocol ping
and answers it only where the mode says so. websockets is used only to offer permessage-deflate.

Modes, run one at a time:
  book     62 s on one socket: order_book for BTC, ETH, 1000PEPE, XAU, OPENAI and BYD, ticker for BTC,
           market_stats/all and height, with an application ping at 20 s and 40 s. At 44 s and 50 s it
           unsubscribes and resubscribes BTC and then ETH, and compares each fresh snapshot with the book
           it rebuilt from deltas at the same nonce. Once market_stats/all has named 150 markets, it reads
           REST funding-rates once and divides each Lighter rate by the socket's current_funding_rate as a fraction.
  errors   unknown, malformed and inactive markets, an array subscribe, an unknown type, a duplicate
           subscribe and an unsubscribe, 3 s apart, reopening the socket if one case closes it.
  batch    one REST orderBookDetails call for the active list, then market_stats/all and order_book for every
           active perpetual paced SUB_GAP_S apart, held 30 s after the last subscribe, with an application ping
           every 25 s. It also measures how long each market goes without a market_stats row.
  silence  two sockets at once for up to 135 s, neither answering a ping: one subscribes nothing and
           sends nothing, the other subscribes height, a frame every 500 ms, and then sends nothing.
  twin     two sockets, the second opened about 5 s after the first, each subscribing BTC and ETH and
           rebuilding both books for 20 s, compared on the top 50 levels at every nonce both saw.
  quiet    45 s of market_stats/all beside market_stats and ticker for four markets that went quiet in
           the batch run, to see whether a market missing from an all frame is unchanged.
  deflate  four handshakes: the plain URL with and without permessage-deflate offered, and the read-only URL
           with and without it, recording a refusal's status, headers and body.
Every other mode uses the read-only URL, because the plain URL answered HTTP 400 with code 20558,
"restricted jurisdiction", to this host's Canadian exit on 2026-10-12.

Run from the repository root with: uv run scripts/probes/venues/lighter/ws-probe.py <mode> [label]
Captures land in .claude/survey-work/lighter/.
"""

import collections
import json
import pathlib
import queue
import statistics
import sys
import threading
import time
import urllib.request

import websocket

URL_PLAIN = "wss://mainnet.zklighter.elliot.ai/stream"
URL = URL_PLAIN + "?readonly=true"  # the documented read-only entrance, since the plain URL refuses this host's Canadian exit with code 20558
REST = "https://mainnet.zklighter.elliot.ai/api/v1/"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "lighter"
WORK.mkdir(parents=True, exist_ok=True)
UA = "arbitrage-observatory-probe/1.0 (read-only research)"
SUB_GAP_S = 0.5
OUT = {}


def now_ms():
    return time.time() * 1000.0


def pct(xs, p):
    if not xs:
        return None
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(p / 100.0 * len(xs)))], 1)


def dist(xs):
    return {"n": len(xs), "min": pct(xs, 0), "p10": pct(xs, 10), "p50": pct(xs, 50), "p90": pct(xs, 90), "p99": pct(xs, 99), "max": pct(xs, 100)}


class Sock:
    """One socket with a reader thread that stamps every frame on arrival and reassembles fragments."""

    def __init__(self, url=URL, answer_pings=True):
        t0 = time.perf_counter()
        self.ws = websocket.create_connection(url, header=[f"User-Agent: {UA}"], enable_multithread=True, timeout=30)
        self.open_ms = round((time.perf_counter() - t0) * 1000, 1)
        self.status = self.ws.getstatus()
        self.headers = dict(self.ws.getheaders() or {})
        self.ws.settimeout(None)
        self.answer_pings = answer_pings
        self.q = queue.Queue()
        self.closed = None
        self.protocol_pings = []
        self.sent = []
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        buf, op0 = [], None
        try:
            while True:
                f = self.ws.recv_frame()
                t = now_ms()
                if f.opcode == websocket.ABNF.OPCODE_PING:
                    self.protocol_pings.append(t)
                    if self.answer_pings:
                        self.ws.pong(f.data)
                    continue
                if f.opcode == websocket.ABNF.OPCODE_PONG:
                    self.q.put((t, "protocol-pong", f.data))
                    continue
                if f.opcode == websocket.ABNF.OPCODE_CLOSE:
                    code = int.from_bytes(f.data[:2], "big") if len(f.data) >= 2 else None
                    self.closed = {"at_ms": t, "code": code, "reason": f.data[2:].decode("utf-8", "replace")}
                    self.q.put((t, "close", self.closed))
                    return
                if f.opcode in (websocket.ABNF.OPCODE_TEXT, websocket.ABNF.OPCODE_BINARY):
                    buf, op0 = [f.data], f.opcode
                elif f.opcode == websocket.ABNF.OPCODE_CONT:
                    buf.append(f.data)
                if f.fin:
                    data = b"".join(buf)
                    self.q.put((t, "text" if op0 == websocket.ABNF.OPCODE_TEXT else "binary", data))
                    buf = []
        except Exception as e:
            if self.closed is None:
                self.closed = {"at_ms": now_ms(), "code": None, "reason": f"no close frame: {type(e).__name__} {e}"}
            self.q.put((now_ms(), "close", self.closed))

    def send(self, obj):
        s = json.dumps(obj, separators=(",", ":"))
        self.sent.append((now_ms(), s))
        self.ws.send(s)

    def drain(self, until_ms):
        """Yields (arrival_ms, kind, data) until the deadline or a close."""
        while True:
            left = (until_ms - now_ms()) / 1000.0
            if left <= 0:
                return
            try:
                item = self.q.get(timeout=min(left, 0.2))
            except queue.Empty:
                continue
            yield item
            if item[1] == "close":
                return

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def rest_json(path):
    req = urllib.request.Request(REST + path, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def active_perps():
    js = rest_json("orderBookDetails?filter=perp")
    return [(r["market_id"], r["symbol"]) for r in js["order_book_details"] if r["status"] == "active"]


class BookTracker:
    """Keeps one market's book from order_book frames and checks the documented continuity rule."""

    def __init__(self, keep_history=False):
        self.keep_history = keep_history
        self.history = collections.OrderedDict()  # nonce to a copy of the book, for the resubscribe check
        self.resnapshot_checks = []
        self.bids, self.asks = {}, {}
        self.nonce = None
        self.snapshot = None
        self.updates = 0
        self.gaps = []
        self.offset_back = 0
        self.last_offset = None
        self.update_gaps_ms = []
        self.last_update_ms = None
        self.levels_per_update = []
        self.zero_levels = 0
        self.empty_updates = 0
        self.crossed = 0
        self.order_violations = 0
        self.top_by_nonce = {}
        self.max_depth = [0, 0]
        self.nonce_steps = []

    def apply_levels(self, side, levels):
        book = self.bids if side == "bids" else self.asks
        for lv in levels:
            p, s = float(lv["price"]), float(lv["size"])
            if s == 0:
                self.zero_levels += 1
                book.pop(p, None)
            else:
                book[p] = s

    def check_order(self, ob):
        b = [float(x["price"]) for x in ob.get("bids") or []]
        a = [float(x["price"]) for x in ob.get("asks") or []]
        return b == sorted(b, reverse=True), a == sorted(a)

    def on_frame(self, msg, t):
        ob = msg.get("order_book") or {}
        typ = msg.get("type")
        off = msg.get("offset")
        if self.last_offset is not None and off is not None and off < self.last_offset:
            self.offset_back += 1
        self.last_offset = off
        if typ == "subscribed/order_book" and self.keep_history and self.history:
            snap_b = {float(x["price"]): float(x["size"]) for x in ob.get("bids") or []}
            snap_a = {float(x["price"]): float(x["size"]) for x in ob.get("asks") or []}
            old = self.history.get(ob.get("nonce"))
            below = [n for n in self.history if n <= (ob.get("nonce") or 0)]
            self.resnapshot_checks.append({
                "snapshot_nonce": ob.get("nonce"), "last_tracked_nonce": next(reversed(self.history)),
                "state_at_same_nonce": old is not None,
                "bids_equal": old is not None and old[0] == snap_b, "asks_equal": old is not None and old[1] == snap_a,
                "levels": [len(snap_b), len(snap_a)],
                "nearest_lower_nonce": max(below) if below else None,
                "top20_equal_nearest": (lambda h: h is not None and sorted(h[0].items(), reverse=True)[:20] == sorted(snap_b.items(), reverse=True)[:20]
                                        and sorted(h[1].items())[:20] == sorted(snap_a.items())[:20])(self.history.get(max(below)) if below else None),
            })
        if typ == "subscribed/order_book":
            bo, ao = self.check_order(ob)
            self.snapshot = {"bids": len(ob.get("bids") or []), "asks": len(ob.get("asks") or []), "bids_desc": bo, "asks_asc": ao,
                             "nonce": ob.get("nonce"), "begin_nonce": ob.get("begin_nonce"), "offset": off, "code": ob.get("code"),
                             "zero_sizes": sum(1 for x in (ob.get("bids") or []) + (ob.get("asks") or []) if float(x["size"]) == 0)}
            self.bids, self.asks = {}, {}
            self.apply_levels("bids", ob.get("bids") or [])
            self.apply_levels("asks", ob.get("asks") or [])
            self.nonce = ob.get("nonce")
        elif typ == "update/order_book":
            self.updates += 1
            if self.last_update_ms is not None:
                self.update_gaps_ms.append(t - self.last_update_ms)
            self.last_update_ms = t
            if self.nonce is not None and ob.get("begin_nonce") != self.nonce:
                self.gaps.append({"expected": self.nonce, "begin_nonce": ob.get("begin_nonce"), "nonce": ob.get("nonce")})
            if self.nonce is not None and ob.get("nonce") is not None:
                self.nonce_steps.append(ob["nonce"] - self.nonce)
            n = len(ob.get("bids") or []) + len(ob.get("asks") or [])
            self.levels_per_update.append(n)
            if n == 0:
                self.empty_updates += 1
            bo, ao = self.check_order(ob)
            if not (bo and ao):
                self.order_violations += 1
            self.apply_levels("bids", ob.get("bids") or [])
            self.apply_levels("asks", ob.get("asks") or [])
            self.nonce = ob.get("nonce")
        if self.bids and self.asks and max(self.bids) >= min(self.asks):
            self.crossed += 1
        self.max_depth = [max(self.max_depth[0], len(self.bids)), max(self.max_depth[1], len(self.asks))]
        if self.keep_history and self.nonce is not None:
            self.history[self.nonce] = (dict(self.bids), dict(self.asks))
            if len(self.history) > 200:
                self.history.popitem(last=False)
        if self.nonce is not None:
            bb = max(self.bids) if self.bids else None
            ba = min(self.asks) if self.asks else None
            self.top_by_nonce[self.nonce] = (bb, self.bids.get(bb), ba, self.asks.get(ba))
            if len(self.top_by_nonce) > 5000:
                self.top_by_nonce.pop(next(iter(self.top_by_nonce)))

    def summary(self):
        return {"snapshot": self.snapshot, "updates": self.updates, "gaps": len(self.gaps), "gap_examples": self.gaps[:3],
                "offset_went_back": self.offset_back, "update_interval_ms": dist(self.update_gaps_ms),
                "levels_per_update": dist(self.levels_per_update), "zero_size_levels": self.zero_levels,
                "empty_updates": self.empty_updates, "crossed_states": self.crossed, "unsorted_updates": self.order_violations,
                "max_depth_held": self.max_depth, "nonce_step": dist(self.nonce_steps),
                "final_depth": [len(self.bids), len(self.asks)], "resnapshot_checks": self.resnapshot_checks}


def sample_of(msg):
    """A copy of one parsed frame, cut to three levels a side and two markets, for quoting in the profile."""
    m = json.loads(json.dumps(msg))
    ob = m.get("order_book")
    if isinstance(ob, dict):
        for side in ("bids", "asks"):
            if isinstance(ob.get(side), list):
                ob[side] = ob[side][:3]
    ms = m.get("market_stats")
    if isinstance(ms, dict) and "market_id" not in ms:
        m["market_stats"] = {k: ms[k] for k in list(ms)[:2]}
    return m


def trim(raw, n=700):
    s = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
    return s if len(s) <= n else s[:n] + "...<cut>"


def mode_book():
    ids = {"BTC": 1, "ETH": 0, "1000PEPE": 4, "XAU": 92, "OPENAI": 192, "BYD": 200}
    s = Sock()
    OUT["handshake"] = {"status": s.status, "open_ms": s.open_ms, "headers": s.headers}
    trackers = {mid: BookTracker(keep_history=mid in (1, 0)) for mid in ids.values()}
    t_start = now_ms()
    plan = [(0.5 + i * SUB_GAP_S, {"type": "subscribe", "channel": f"order_book/{mid}"}) for i, mid in enumerate(ids.values())]
    plan += [(44.0, {"type": "unsubscribe", "channel": "order_book/1"}), (45.0, {"type": "subscribe", "channel": "order_book/1"}),
             (50.0, {"type": "unsubscribe", "channel": "order_book/0"}), (51.0, {"type": "subscribe", "channel": "order_book/0"})]
    k = len(plan)
    plan += [(0.5 + (k + 0) * SUB_GAP_S, {"type": "subscribe", "channel": "ticker/1"}),
             (0.5 + (k + 1) * SUB_GAP_S, {"type": "subscribe", "channel": "market_stats/all"}),
             (0.5 + (k + 2) * SUB_GAP_S, {"type": "subscribe", "channel": "height"}),
             (20.0, {"type": "ping"}), (40.0, {"type": "ping"})]
    plan.sort(key=lambda x: x[0])
    first_by_type, counts, sizes, ages, ages_lu = {}, collections.Counter(), collections.defaultdict(list), collections.defaultdict(list), []
    stats_frames, stats_markets_per_frame, stats_btc, stats_intervals, last_stats = [], [], [], [], None
    ticker_checks = {"compared": 0, "equal": 0, "no_book_state": 0, "examples": []}
    heights, pongs, other = [], [], []
    parse_us = []
    stats_latest = {}
    fr_check = {}
    samples = {}
    end = t_start + 62_000
    while now_ms() < end:
        while plan and now_ms() - t_start >= plan[0][0] * 1000:
            _, m = plan.pop(0)
            s.send(m)
        for t, kind, data in s.drain(min(end, now_ms() + 100)):
            if kind == "close":
                OUT["closed"] = data
                break
            if kind != "text":
                other.append((round(t - t_start), kind, trim(data, 200)))
                continue
            p0 = time.perf_counter()
            msg = json.loads(data)
            parse_us.append((time.perf_counter() - p0) * 1e6)
            typ = msg.get("type", "?")
            counts[typ] += 1
            sizes[typ].append(len(data))
            if typ not in samples:
                samples[typ] = sample_of(msg)
            if typ not in first_by_type:
                first_by_type[typ] = {"at_ms": round(t - t_start), "frame": trim(data, 1500)}
            if "timestamp" in msg and isinstance(msg["timestamp"], (int, float)):
                ages[typ].append(t - msg["timestamp"])
            ch = msg.get("channel", "")
            if typ.endswith("order_book"):
                mid = int(ch.split(":")[1])
                lu = msg.get("last_updated_at") or (msg.get("order_book") or {}).get("last_updated_at")
                if lu:
                    ages_lu.append(t - lu / 1000.0)
                trackers[mid].on_frame(msg, t)
            elif typ.endswith("ticker"):
                tk = msg.get("ticker") or {}
                st = trackers[1].top_by_nonce.get(msg.get("nonce"))
                if st is None:
                    ticker_checks["no_book_state"] += 1
                else:
                    ticker_checks["compared"] += 1
                    got = (float(tk["b"]["price"]), float(tk["b"]["size"]), float(tk["a"]["price"]), float(tk["a"]["size"]))
                    if got == st:
                        ticker_checks["equal"] += 1
                    elif len(ticker_checks["examples"]) < 3:
                        ticker_checks["examples"].append({"nonce": msg.get("nonce"), "ticker": got, "book": st})
            elif typ.endswith("market_stats"):
                ms = msg.get("market_stats") or {}
                stats_frames.append(t)
                if last_stats is not None:
                    stats_intervals.append(t - last_stats)
                last_stats = t
                if isinstance(ms, dict) and "market_id" in ms:
                    stats_markets_per_frame.append(1)
                    if ms.get("market_id") == 1:
                        stats_btc.append((t, ms.get("index_price"), ms.get("mark_price"), ms.get("current_funding_rate"), ms.get("funding_rate"), ms.get("funding_timestamp")))
                elif isinstance(ms, dict):
                    stats_markets_per_frame.append(len(ms))
                    stats_latest.update({k: v for k, v in ms.items() if isinstance(v, dict)})
                    if not fr_check and len(stats_latest) > 150:
                        try:
                            fr = rest_json("funding-rates")
                            rows = {str(x["market_id"]): x["rate"] for x in fr["funding_rates"] if x["exchange"] == "lighter"}
                            ratios = []
                            for k, rate in rows.items():
                                cur = float((stats_latest.get(k) or {}).get("current_funding_rate") or "nan")
                                if cur == cur and cur != 0:
                                    ratios.append(rate / (cur / 100.0))
                            fr_check = {"at_ms": round(now_ms() - t_start), "lighter_rows": len(rows), "compared": len(ratios),
                                        "ratio_rest_over_socket_fraction": dist(ratios),
                                        "btc": {"rest": rows.get("1"), "socket_current": (stats_latest.get("1") or {}).get("current_funding_rate")}}
                        except Exception as e:
                            fr_check = {"error": repr(e)}
                    b = ms.get("1") or ms.get(1)
                    if b:
                        stats_btc.append((t, b.get("index_price"), b.get("mark_price"), b.get("current_funding_rate"), b.get("funding_rate"), b.get("funding_timestamp")))
            elif typ.endswith("height"):
                heights.append((t, msg.get("height"), msg.get("timestamp")))
            elif typ == "pong":
                sent_at = max(x[0] for x in s.sent if '"ping"' in x[1])
                pongs.append(round(t - sent_at, 1))
            else:
                other.append((round(t - t_start), typ, trim(data, 400)))
        if s.closed:
            break
    s.close()
    OUT["counts"] = dict(counts)
    OUT["bytes"] = {k: dist(v) for k, v in sizes.items()}
    OUT["first_by_type"] = first_by_type
    OUT["samples_trimmed"] = samples
    OUT["age_vs_envelope_timestamp_ms"] = {k: dist(v) for k, v in ages.items()}
    OUT["age_vs_last_updated_at_ms"] = dist(ages_lu)
    OUT["books"] = {name: trackers[mid].summary() for name, mid in ids.items()}
    OUT["ticker_vs_book_at_same_nonce"] = ticker_checks
    OUT["market_stats"] = {"frames": len(stats_frames), "markets_per_frame": dist(stats_markets_per_frame),
                           "interval_ms": dist(stats_intervals), "btc_updates": len(stats_btc),
                           "btc_index_changes": sum(1 for a, b in zip(stats_btc, stats_btc[1:]) if a[1] != b[1]),
                           "btc_mark_changes": sum(1 for a, b in zip(stats_btc, stats_btc[1:]) if a[2] != b[2]),
                           "btc_samples": stats_btc[:3] + stats_btc[-2:],
                           "btc_interval_ms": dist([b[0] - a[0] for a, b in zip(stats_btc, stats_btc[1:])])}
    OUT["funding_rates_vs_socket"] = fr_check
    vals = [float(v.get("current_funding_rate") or "nan") for v in stats_latest.values()]
    OUT["socket_funding_fields"] = {
        "markets": len(stats_latest), "current_negative": sum(1 for x in vals if x < 0), "current_zero": sum(1 for x in vals if x == 0),
        "current_min": min(vals) if vals else None, "current_max": max(vals) if vals else None,
        "funding_timestamp_values": dict(collections.Counter(v.get("funding_timestamp") for v in stats_latest.values()).most_common(4)),
        "funding_rate_last_negative": sum(1 for v in stats_latest.values() if float(v.get("funding_rate") or 0) < 0),
        "mark_eq_index": sum(1 for v in stats_latest.values() if v.get("mark_price") == v.get("index_price")),
        "premium_examples": {v.get("symbol"): (v.get("premium"), v.get("mark_price"), v.get("index_price")) for v in stats_latest.values() if v.get("symbol") in ("BTC", "ETH", "XAU", "OPENAI")},
    }
    OUT["height"] = {"frames": len(heights), "first": heights[:2], "last": heights[-1:],
                     "interval_ms": dist([b[0] - a[0] for a, b in zip(heights, heights[1:])]),
                     "height_step": dist([b[1] - a[1] for a, b in zip(heights, heights[1:]) if a[1] is not None and b[1] is not None])}
    OUT["pong_rtt_ms"] = pongs
    OUT["protocol_pings_from_server"] = len(s.protocol_pings)
    OUT["parse_us"] = dist(parse_us)
    OUT["other_frames"] = other[:20]
    OUT["sent"] = s.sent


def mode_errors():
    cases = [
        ("unknown market", {"type": "subscribe", "channel": "order_book/9999"}),
        ("malformed market", {"type": "subscribe", "channel": "order_book/abc"}),
        ("inactive market MKR", {"type": "subscribe", "channel": "order_book/28"}),
        ("colon form", {"type": "subscribe", "channel": "order_book:2"}),
        ("array of channels", {"type": "subscribe", "channels": ["order_book/2", "order_book/24"]}),
        ("comma list", {"type": "subscribe", "channel": "order_book/2,order_book/24"}),
        ("unknown type", {"type": "nope"}),
        ("missing channel", {"type": "subscribe"}),
        ("unknown market stats", {"type": "subscribe", "channel": "market_stats/9999"}),
        ("first subscribe SOL", {"type": "subscribe", "channel": "order_book/2"}),
        ("duplicate subscribe SOL", {"type": "subscribe", "channel": "order_book/2"}),
        ("unsubscribe SOL", {"type": "unsubscribe", "channel": "order_book/2"}),
        ("unsubscribe not subscribed", {"type": "unsubscribe", "channel": "order_book/24"}),
    ]
    res = []
    s = Sock()
    connected = []
    for t, kind, data in s.drain(now_ms() + 1500):
        connected.append(trim(data, 300))
    OUT["on_open"] = connected
    for name, frame in cases:
        if s.closed:
            res.append({"case": "reopen after close", "closed": s.closed})
            s = Sock()
            for _ in s.drain(now_ms() + 1000):
                pass
        sent_at = now_ms()
        s.send(frame)
        got = collections.Counter()
        firsts = []
        last_book_at = None
        for t, kind, data in s.drain(sent_at + 3000):
            if kind == "close":
                firsts.append({"after_ms": round(t - sent_at), "close": data})
                break
            msg = json.loads(data) if kind == "text" else {"binary": True}
            typ = msg.get("type", "?")
            got[typ] += 1
            if typ.endswith("order_book"):
                last_book_at = round(t - sent_at)
            if got[typ] <= 1:
                firsts.append({"after_ms": round(t - sent_at), "frame": trim(data, 500)})
        res.append({"case": name, "sent": frame, "types": dict(got), "first_frames": firsts, "last_book_frame_after_ms": last_book_at,
                    "closed": s.closed})
    s.close()
    OUT["cases"] = res


def mode_batch():
    markets = active_perps()
    OUT["markets"] = len(markets)
    s = Sock()
    OUT["handshake"] = {"status": s.status, "open_ms": s.open_ms}
    trackers = {mid: BookTracker() for mid, _ in markets}
    t_start = now_ms()
    plan = [(0.5, {"type": "subscribe", "channel": "market_stats/all"})]
    plan += [(1.0 + i * SUB_GAP_S, {"type": "subscribe", "channel": f"order_book/{mid}"}) for i, (mid, _) in enumerate(markets)]
    last_sub = plan[-1][0]
    plan += [(x, {"type": "ping"}) for x in range(25, int(last_sub) + 31, 25)]
    plan.sort(key=lambda x: x[0])
    end = t_start + (last_sub + 30.0) * 1000
    counts, nbytes, parse_us, ages, snap_levels, other = collections.Counter(), 0, [], [], [], []
    stats_intervals, last_stats, stats_sizes, stats_keys = [], None, [], set()
    stats_rows_by_market = collections.Counter()
    stats_last_row, stats_row_gaps = {}, collections.defaultdict(list)
    subs_at, snap_at = {}, {}
    window = collections.deque()
    max_frames_per_s = 0
    while now_ms() < end:
        while plan and now_ms() - t_start >= plan[0][0] * 1000:
            _, m = plan.pop(0)
            s.send(m)
            if m.get("channel", "").startswith("order_book/"):
                subs_at[int(m["channel"].split("/")[1])] = now_ms()
        for t, kind, data in s.drain(min(end, now_ms() + 100)):
            if kind == "close":
                OUT["closed"] = data
                break
            if kind != "text":
                other.append((round(t - t_start), kind, trim(data, 200)))
                continue
            nbytes += len(data)
            window.append(t)
            while window and window[0] < t - 1000:
                window.popleft()
            max_frames_per_s = max(max_frames_per_s, len(window))
            p0 = time.perf_counter()
            msg = json.loads(data)
            parse_us.append((time.perf_counter() - p0) * 1e6)
            typ = msg.get("type", "?")
            counts[typ] += 1
            if "timestamp" in msg and isinstance(msg["timestamp"], (int, float)) and typ.endswith("order_book"):
                ages.append(t - msg["timestamp"])
            if typ.endswith("order_book"):
                mid = int(msg["channel"].split(":")[1])
                if typ.startswith("subscribed"):
                    ob = msg.get("order_book") or {}
                    snap_levels.append((len(ob.get("bids") or []), len(ob.get("asks") or [])))
                    snap_at[mid] = t
                trackers[mid].on_frame(msg, t)
            elif typ.endswith("market_stats"):
                ms = msg.get("market_stats") or {}
                if last_stats is not None:
                    stats_intervals.append(t - last_stats)
                last_stats = t
                stats_sizes.append(len(data))
                if isinstance(ms, dict) and "market_id" in ms:
                    ms = {str(ms["market_id"]): ms}
                if isinstance(ms, dict):
                    for k, v in ms.items():
                        stats_rows_by_market[k] += 1
                        if k in stats_last_row:
                            stats_row_gaps[k].append(t - stats_last_row[k])
                        stats_last_row[k] = t
                        if isinstance(v, dict):
                            stats_keys.update(v.keys())
            elif typ not in ("pong",):
                other.append((round(t - t_start), typ, trim(data, 300)))
        if s.closed:
            break
    s.close()
    t_end_stats = now_ms()
    dur_s = (now_ms() - t_start) / 1000.0
    summ = {mid: trackers[mid].summary() for mid, _ in markets}
    no_snap = [sym for mid, sym in markets if trackers[mid].snapshot is None]
    OUT["duration_s"] = round(dur_s, 1)
    OUT["counts"] = dict(counts)
    OUT["bytes_per_s"] = round(nbytes / dur_s)
    OUT["frames_per_s"] = round(sum(counts.values()) / dur_s, 1)
    OUT["max_frames_in_1s"] = max_frames_per_s
    OUT["parse_us"] = dist(parse_us)
    OUT["age_vs_envelope_ms"] = dist(ages)
    OUT["snapshot_after_subscribe_ms"] = dist([snap_at[m] - subs_at[m] for m in snap_at if m in subs_at])
    OUT["snapshot_levels_bids"] = dist([x[0] for x in snap_levels])
    OUT["snapshot_levels_asks"] = dist([x[1] for x in snap_levels])
    OUT["one_sided_or_empty_snapshots"] = [sym for mid, sym in markets if trackers[mid].snapshot and (trackers[mid].snapshot["bids"] == 0 or trackers[mid].snapshot["asks"] == 0)]
    OUT["markets_without_snapshot"] = no_snap
    OUT["total_gaps"] = sum(x["gaps"] for x in summ.values())
    OUT["markets_with_gaps"] = {sym: summ[mid]["gaps"] for mid, sym in markets if summ[mid]["gaps"]}
    OUT["total_updates"] = sum(x["updates"] for x in summ.values())
    OUT["updates_per_market"] = dist([x["updates"] for x in summ.values()])
    OUT["markets_with_no_update"] = [sym for mid, sym in markets if summ[mid]["updates"] == 0]
    OUT["update_interval_p50_per_market"] = dist([x["update_interval_ms"]["p50"] for x in summ.values() if x["update_interval_ms"]["p50"] is not None])
    OUT["min_update_interval_ms"] = min((x["update_interval_ms"]["min"] for x in summ.values() if x["update_interval_ms"]["min"] is not None), default=None)
    OUT["empty_updates"] = sum(x["empty_updates"] for x in summ.values())
    OUT["unsorted_updates"] = sum(x["unsorted_updates"] for x in summ.values())
    OUT["unsorted_snapshots"] = [sym for mid, sym in markets if trackers[mid].snapshot and not (trackers[mid].snapshot["bids_desc"] and trackers[mid].snapshot["asks_asc"])]
    OUT["crossed_markets"] = {sym: summ[mid]["crossed_states"] for mid, sym in markets if summ[mid]["crossed_states"]}
    OUT["offset_went_back"] = sum(x["offset_went_back"] for x in summ.values())
    OUT["nonce_step_p50"] = dist([x["nonce_step"]["p50"] for x in summ.values() if x["nonce_step"]["p50"] is not None])
    OUT["market_stats"] = {"frames": counts.get("update/market_stats", 0) + counts.get("subscribed/market_stats", 0),
                           "interval_ms": dist(stats_intervals), "bytes": dist(stats_sizes),
                           "rows_per_market": dist(list(stats_rows_by_market.values())), "markets_seen": len(stats_rows_by_market),
                           "keys": sorted(stats_keys),
                           "max_row_gap_ms_per_market": dist([max(g) for g in stats_row_gaps.values() if g]),
                           "markets_with_a_gap_over_10s": sorted(k for k, g in stats_row_gaps.items() if g and max(g) > 10_000),
                           "markets_with_one_row_only": sorted(k for k, n in stats_rows_by_market.items() if n == 1),
                           "silent_after_first_row_s": {k: round((t_end_stats - stats_last_row[k]) / 1000, 1) for k in stats_last_row
                                                         if t_end_stats - stats_last_row[k] > 10_000}}
    OUT["other_frames"] = other[:20]
    OUT["examples"] = {sym: summ[mid] for mid, sym in markets if sym in ("BTC", "ETH", "XAU", "BYD", "OPENAI")}


def mode_silence():
    def watch(name, subscribe, results):
        s = Sock(answer_pings=False)
        t_start = now_ms()
        if subscribe:
            s.send({"type": "subscribe", "channel": "height"})
        frames, kinds, last_server = [], collections.Counter(), None
        for t, kind, data in s.drain(t_start + 135_000):
            kinds[kind] += 1
            if kind != "close":
                last_server = t
            if len(frames) < 6 or kind == "close":
                frames.append((round(t - t_start), kind, trim(data, 200)))
            if kind == "close":
                break
        results[name] = {"handshake": {"status": s.status, "open_ms": s.open_ms}, "sent": [x[1] for x in s.sent],
                         "frame_kinds": dict(kinds), "frames": frames,
                         "protocol_pings_ms": [round(x - t_start) for x in s.protocol_pings],
                         "closed": s.closed, "closed_after_ms": round(s.closed["at_ms"] - t_start) if s.closed else None,
                         "last_server_frame_before_close_ms": round(s.closed["at_ms"] - last_server) if s.closed and last_server else None}
        s.close()

    results = {}
    threads = [threading.Thread(target=watch, args=("idle_no_subscription", False, results)),
               threading.Thread(target=watch, args=("subscribed_height_then_silent", True, results))]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    OUT.update(results)


def mode_twin():
    """Two sockets rebuild BTC and ETH from their own snapshots and deltas, compared at every nonce both saw."""
    ids = {"BTC": 1, "ETH": 0}
    socks, trackers, hist = [], [], []
    for k in range(2):
        s = Sock()
        socks.append(s)
        trackers.append({mid: BookTracker() for mid in ids.values()})
        hist.append({mid: {} for mid in ids.values()})
        for mid in ids.values():
            s.send({"type": "subscribe", "channel": f"order_book/{mid}"})
            time.sleep(SUB_GAP_S)
        if k == 0:
            time.sleep(4.0)
    end = now_ms() + 20_000
    while now_ms() < end:
        idle = True
        for k, s in enumerate(socks):
            while True:
                try:
                    t, kind, data = s.q.get_nowait()
                except queue.Empty:
                    break
                idle = False
                if kind != "text":
                    continue
                msg = json.loads(data)
                if not msg.get("type", "").endswith("order_book"):
                    continue
                mid = int(msg["channel"].split(":")[1])
                tr = trackers[k][mid]
                tr.on_frame(msg, t)
                if tr.nonce is not None:
                    hist[k][mid][tr.nonce] = (sorted(tr.bids.items(), reverse=True)[:50], sorted(tr.asks.items())[:50])
        if idle:
            time.sleep(0.01)
    for s in socks:
        s.close()
    res = {}
    for name, mid in ids.items():
        shared = sorted(set(hist[0][mid]) & set(hist[1][mid]))
        equal = sum(1 for n in shared if hist[0][mid][n] == hist[1][mid][n])
        res[name] = {"nonces_socket_a": len(hist[0][mid]), "nonces_socket_b": len(hist[1][mid]), "shared_nonces": len(shared),
                     "top50_equal_at_shared_nonce": equal,
                     "snapshot_b_nonce_seen_on_a": trackers[1][mid].snapshot is not None and trackers[1][mid].snapshot["nonce"] in hist[0][mid],
                     "gaps": [trackers[0][mid].summary()["gaps"], trackers[1][mid].summary()["gaps"]],
                     "first_mismatch": next(({"nonce": n, "a_top3": [hist[0][mid][n][0][:3], hist[0][mid][n][1][:3]],
                                              "b_top3": [hist[1][mid][n][0][:3], hist[1][mid][n][1][:3]]}
                                             for n in shared if hist[0][mid][n] != hist[1][mid][n]), None)}
    OUT["twin"] = res


def mode_quiet():
    """Whether a market missing from a market_stats/all frame is unchanged, on four markets that went quiet in the batch run."""
    ids = [17, 18, 19, 23]
    s = Sock()
    plan = [{"type": "subscribe", "channel": "market_stats/all"}]
    plan += [{"type": "subscribe", "channel": f"market_stats/{m}"} for m in ids]
    plan += [{"type": "subscribe", "channel": f"ticker/{m}"} for m in ids]
    for m in plan:
        s.send(m)
        time.sleep(SUB_GAP_S)
    t_start = now_ms()
    rows_all, rows_one, ticks = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    for t, kind, data in s.drain(t_start + 45_000):
        if kind != "text":
            continue
        msg = json.loads(data)
        ch, ms = msg.get("channel", ""), msg.get("market_stats")
        if ch == "market_stats:all" and isinstance(ms, dict):
            for k, v in ms.items():
                if int(k) in ids:
                    rows_all[int(k)].append((t, v.get("index_price"), v.get("mark_price"), v.get("best_bid_price"), v.get("best_ask_price")))
        elif ch.startswith("market_stats:") and isinstance(ms, dict):
            m = int(ch.split(":")[1])
            rows_one[m].append((t, ms.get("index_price"), ms.get("mark_price"), ms.get("best_bid_price"), ms.get("best_ask_price")))
        elif ch.startswith("ticker:"):
            m = int(ch.split(":")[1])
            tk = msg.get("ticker") or {}
            ticks[m].append((t, (tk.get("b") or {}).get("price"), (tk.get("a") or {}).get("price")))
    s.close()
    res = {}
    for m in ids:
        a, o, k = rows_all[m], rows_one[m], ticks[m]
        bbo_changes = [x[0] for x, y in zip(k, k[1:]) if (x[1], x[2]) != (y[1], y[2])]
        all_times = [x[0] for x in a]
        unexplained = 0
        for t in bbo_changes:
            nxt = [x for x in all_times if x >= t]
            if not nxt or nxt[0] - t > 1500:
                unexplained += 1
        res[m] = {"rows_all": len(a), "rows_own_channel": len(o), "ticker_frames": len(k), "bbo_price_changes": len(bbo_changes),
                  "bbo_changes_without_an_all_row_within_1_5s": unexplained,
                  "max_gap_all_ms": round(max((y[0] - x[0] for x, y in zip(a, a[1:])), default=0)),
                  "max_gap_own_ms": round(max((y[0] - x[0] for x, y in zip(o, o[1:])), default=0)),
                  "index_changes_all": sum(1 for x, y in zip(a, a[1:]) if x[1] != y[1]),
                  "own_rows_identical_to_previous": sum(1 for x, y in zip(o, o[1:]) if x[1:] == y[1:])}
    OUT["quiet"] = res


def mode_deflate():
    import asyncio
    import websockets

    async def offer(url, compression):
        t0 = time.perf_counter()
        async with websockets.connect(url, compression=compression, user_agent_header=UA, open_timeout=15, ping_interval=None) as ws:
            ms = round((time.perf_counter() - t0) * 1000, 1)
            hdr = dict(ws.response.headers)
            first = None
            try:
                first = await asyncio.wait_for(ws.recv(), 3)
            except Exception as e:
                first = repr(e)
            return {"open_ms": ms, "status": ws.response.status_code, "extensions": hdr.get("Sec-WebSocket-Extensions") or hdr.get("sec-websocket-extensions"),
                    "headers": hdr, "first_frame": first if isinstance(first, str) else repr(first)}

    def attempt(url, compression):
        try:
            return asyncio.run(offer(url, compression))
        except websockets.exceptions.InvalidStatus as e:
            r = e.response
            return {"rejected_status": r.status_code, "headers": dict(r.headers), "body": trim(r.body or b"", 600)}
        except Exception as e:
            return {"error": repr(e)}

    OUT["deflate_offered"] = attempt(URL_PLAIN, "deflate")
    time.sleep(1)
    OUT["readonly_plain"] = attempt(URL, None)
    time.sleep(1)
    OUT["plain"] = attempt(URL_PLAIN, None)
    time.sleep(1)
    OUT["readonly_deflate"] = attempt(URL, "deflate")


MODE = sys.argv[1] if len(sys.argv) > 1 else "book"
LABEL = sys.argv[2] if len(sys.argv) > 2 else time.strftime("%H%M", time.gmtime())

if __name__ == "__main__":
    OUT["mode"] = MODE
    OUT["started_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    {"book": mode_book, "errors": mode_errors, "batch": mode_batch, "silence": mode_silence, "deflate": mode_deflate,
     "twin": mode_twin, "quiet": mode_quiet}[MODE]()
    OUT["ended_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    path = WORK / f"ws-{MODE}-{LABEL}.json"
    path.write_text(json.dumps(OUT, indent=1, default=str))
    print(json.dumps({k: v for k, v in OUT.items() if k not in ("sent",)}, indent=1, default=str)[:12000])
    print("saved", path.relative_to(ROOT))
