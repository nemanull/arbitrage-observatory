# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Altcoin Trader.

Modes, all by default, or name some on the command line:
    book    one socket on /ws for 120 s: orderbook at limit 10 on BTCZAR, USDTZAR and ETHZAR, ticker and trades on BTCZAR.
            It reports acks, the first frame of each kind, whether every orderbook push is a full snapshot,
            push intervals, any sequence field, level order, crossed books, and server pings with their spacing.
    errors  one short socket: an unknown market, an unknown channel, a frame without market, limit 0 and 201,
            a lower case market, a second subscribe to the same market at another depth, unsubscribes, and text that is not JSON.

The client sends no pings of its own, so every ping logged is the server's, and the library answers each with a pong.
Total socket time is about 2.5 minutes.

Run from the repository root:
    uv run scripts/probes/venues/altcoin-trader/ws-probe.py [mode ...]
"""

import asyncio
import json
import logging
import statistics
import sys
import time

import websockets

URL = "wss://api.altcointrader.co.za/ws"
BOOK_S = 120


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


class PingLog(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.pings: list[float] = []
        self.t0 = time.monotonic()

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if msg.startswith("< PING"):
            self.pings.append(round(time.monotonic() - self.t0, 1))


def book_summary(data: dict) -> dict:
    bids, asks = data.get("bids") or [], data.get("asks") or []
    bp = [float(x[0]) for x in bids]
    ap = [float(x[0]) for x in asks]
    return {
        "keys": sorted(data), "bids": len(bids), "asks": len(asks),
        "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
        "crossed": bool(bp and ap and bp[0] >= ap[0]), "zero_sizes": sum(1 for x in bids + asks if float(x[1]) == 0),
    }


async def mode_book() -> None:
    log = PingLog()
    lg = logging.getLogger("websockets")
    lg.setLevel(logging.DEBUG)
    lg.addHandler(log)
    t_open = time.perf_counter()
    async with websockets.connect(URL, ping_interval=None, open_timeout=20, max_size=2**22) as ws:
        out(mode="book", connected_ms=round((time.perf_counter() - t_open) * 1000), response_headers=dict(ws.response.headers))
        subs = [{"action": "subscribe", "channel": "orderbook", "market": m, "limit": 10} for m in ("BTCZAR", "USDTZAR", "ETHZAR")]
        subs += [{"action": "subscribe", "channel": "ticker", "market": "BTCZAR"}, {"action": "subscribe", "channel": "trades", "market": "BTCZAR"}]
        for s in subs:
            await ws.send(json.dumps(s))
        log.t0 = time.monotonic()
        first: dict[str, str] = {}
        counts: dict[str, int] = {}
        arrivals: dict[str, list[float]] = {}
        sizes: dict[str, list[int]] = {}
        summaries: dict[str, dict] = {}
        crossed = 0
        partial = 0
        repeats = 0
        last_book: dict[str, str] = {}
        last_ts: dict[str, int] = {}
        ts_changes = 0
        ts_lag: list[float] = []
        extra_keys: set[str] = set()
        end = time.monotonic() + BOOK_S
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
            except asyncio.TimeoutError:
                break
            now = round(time.monotonic() - log.t0, 3)
            msg = json.loads(raw)
            ch = msg.get("channel")
            key = f"{ch}:{msg.get('market') or msg.get('subscription')}"
            if ch == "subscribed":
                key = f"subscribed:{msg.get('market')}:{msg.get('subscription')}"
            counts[key] = counts.get(key, 0) + 1
            arrivals.setdefault(key, []).append(now)
            sizes.setdefault(key, []).append(len(raw))
            extra_keys |= set(msg) - {"channel", "market", "data", "subscription", "message"}
            if key not in first:
                first[key] = raw[:2000]
            if ch == "orderbook":
                d = msg.get("data") or {}
                sm = book_summary(d)
                summaries.setdefault(key, sm)
                crossed += sm["crossed"]
                if sm["bids"] != 10 or sm["asks"] != 10:
                    partial += 1
                body = json.dumps({"b": d.get("bids"), "a": d.get("asks")})
                ts = d.get("timestamp")
                if isinstance(ts, (int, float)):
                    ts_lag.append(time.time() - (ts / 1000 if ts > 1e12 else ts))
                    if key in last_ts and last_ts[key] != ts:
                        ts_changes += 1
                    last_ts[key] = ts
                if last_book.get(key) == body:
                    repeats += 1
                last_book[key] = body
        gaps = {k: [round(b - a, 2) for a, b in zip(v, v[1:])] for k, v in arrivals.items() if len(v) > 2}
        out(mode="book", seconds=BOOK_S, counts=counts, extra_top_level_keys=sorted(extra_keys))
        for k, v in first.items():
            out(mode="book", first_frame=k, raw=v)
        for k, sm in summaries.items():
            out(mode="book", book=k, first_summary=sm)
        for k, g in gaps.items():
            out(mode="book", intervals=k, n=len(g), min_s=min(g), median_s=statistics.median(g), max_s=max(g),
                mean_bytes=round(statistics.mean(sizes[k])))
        if ts_lag:
            out(mode="book", data_timestamp_changes=ts_changes, data_timestamp_unit="seconds" if max(last_ts.values()) < 1e12 else "milliseconds",
                local_minus_data_timestamp_s={"min": round(min(ts_lag), 2), "median": round(statistics.median(ts_lag), 2), "max": round(max(ts_lag), 2)})
        out(mode="book", orderbook_pushes_not_10_by_10=partial, crossed_pushes=crossed, identical_consecutive_book_pushes=repeats,
            server_pings_at_s=log.pings, ping_spacing_s=[round(b - a, 1) for a, b in zip(log.pings, log.pings[1:])],
            open_after_s=round(time.monotonic() - log.t0, 1))
    lg.removeHandler(log)


async def mode_errors() -> None:
    async with websockets.connect(URL, ping_interval=None, open_timeout=20) as ws:
        unsub = '{"action":"unsubscribe","channel":"orderbook","market":"BTCZAR"}'
        frames = [
            '{"action":"subscribe","channel":"orderbook","market":"NOPEZAR","limit":10}',
            '{"action":"subscribe","channel":"depth","market":"BTCZAR"}',
            '{"action":"subscribe","channel":"orderbook"}',
            '{"action":"subscribe","channel":"orderbook","market":"BTCZAR","limit":0}',
            unsub,
            '{"action":"subscribe","channel":"orderbook","market":"BTCZAR","limit":201}',
            unsub,
            '{"action":"subscribe","channel":"orderbook","market":"btczar","limit":5}',
            '{"action":"subscribe","channel":"orderbook","market":"BTCZAR","limit":3}',
            unsub,
            "ping",
            '{"op":"ping"}',
        ]
        for f in frames:
            await ws.send(f)
            got = []
            end = time.monotonic() + 2.5
            while time.monotonic() < end:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
                except asyncio.TimeoutError:
                    break
                except websockets.ConnectionClosed as e:
                    got.append(f"closed {e.rcvd}")
                    break
                try:
                    m = json.loads(raw)
                except ValueError:
                    got.append(raw[:160])
                    continue
                if m.get("channel") == "orderbook":
                    d = m.get("data") or {}
                    got.append(f"orderbook push {m.get('market')} {len(d.get('bids') or [])} bids {len(d.get('asks') or [])} asks")
                else:
                    got.append(raw.strip()[:200])
            uniq = list(dict.fromkeys(got))
            out(mode="errors", sent=f, replies=uniq, reply_count=len(got))
            if got and str(got[-1]).startswith("closed"):
                break


MODES = {"book": mode_book, "errors": mode_errors}

if __name__ == "__main__":
    out(probe="altcoin-trader ws", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), url=URL)
    for name in sys.argv[1:] or list(MODES):
        try:
            asyncio.run(MODES[name]())
        except Exception as e:  # a refused upgrade is a finding, so print it and go on
            out(mode=name, error=repr(e))
