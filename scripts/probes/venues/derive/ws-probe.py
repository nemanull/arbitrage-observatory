# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp==3.12.15", "httpx==0.28.1"]
# ///
"""Public, read-only WebSocket probe of Derive for the venue profile.

Run from the repository root:
    uv run scripts/probes/venues/derive/ws-probe.py <mode> [seconds]

Modes:
  books   one socket, every perpetual's orderbook.{name}.1.20 and ticker_slim.{name}.1000, plus spot_feed.BTC
  group   BTC-PERP and ETH-PERP books at every group and depth, to read the aggregation
  edge    unknown and malformed channels, the deprecated ticker channel, text ping, an RPC over the socket, a deflate offer
  legacy  the v2 socket CCXT 4.5.68 points at, wss://api.lyra.finance/ws
The socket never offers permessage-deflate except in the one edge check that asks for it, and it answers every server ping by hand.
Captures go to .claude/survey-work/derive/cap/ unless DERIVE_CAP names another folder.
"""

import asyncio
import json
import os
import statistics
import sys
import time
from pathlib import Path

import aiohttp
import httpx

V3_WS = "wss://api.derive.xyz/v3/ws"
V2_WS = "wss://api.lyra.finance/ws"
V3 = "https://api.derive.xyz/v3"
CAP = Path(os.environ.get("DERIVE_CAP", ".claude/survey-work/derive/cap"))


def now_ms() -> int:
    return int(time.time() * 1000)


def iso(ms: int) -> str:
    return time.strftime("%H:%M:%S", time.gmtime(ms / 1000)) + f".{ms % 1000:03d}"


def pct(values, q):
    values = sorted(values)
    if not values:
        return None
    return values[max(0, min(len(values) - 1, round(q * (len(values) - 1))))]


def stats(values):
    if not values:
        return "none"
    return f"n {len(values)}, min {min(values)}, p10 {pct(values, 0.1)}, p50 {pct(values, 0.5)}, p90 {pct(values, 0.9)}, max {max(values)}"


def save(name: str, body) -> None:
    CAP.mkdir(parents=True, exist_ok=True)
    (CAP / name).write_text(body if isinstance(body, str) else json.dumps(body, indent=1))


def perp_names() -> list[str]:
    r = httpx.post(f"{V3}/public/get_all_instruments", json={"expired": False, "instrument_type": "perp"}, timeout=15)
    return sorted(i["instrument_name"] for i in r.json()["result"]["instruments"] if i["is_active"])


class Socket:
    """One aiohttp socket that logs control frames and answers pings by hand."""

    def __init__(self, url: str, compress: int = 0):
        self.url = url
        self.compress = compress
        self.pings = []
        self.next_id = 1

    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        t0 = time.perf_counter()
        try:
            self.ws = await self.session.ws_connect(self.url, autoping=False, compress=self.compress, max_msg_size=0, heartbeat=None)
        except Exception:
            await self.session.close()
            raise
        self.open_ms = (time.perf_counter() - t0) * 1000
        self.opened_at = now_ms()
        hdr = self.ws._response.headers
        self.headers = {k: hdr.get(k) for k in ("Server", "CF-RAY", "Sec-WebSocket-Extensions", "Sec-WebSocket-Protocol") if hdr.get(k)}
        print(f"open {self.url}: {self.open_ms:.0f} ms, status {self.ws._response.status}, headers {self.headers}")
        return self

    async def __aexit__(self, *exc):
        await self.ws.close()
        await self.session.close()

    async def rpc(self, method: str, params: dict | None = None) -> int:
        rid = self.next_id
        self.next_id += 1
        await self.ws.send_str(json.dumps({"id": rid, "method": method, "params": params or {}}))
        return rid

    async def frames(self, seconds: float):
        """Yields (recv_ms, kind, payload) until the deadline, answering pings."""
        deadline = time.monotonic() + seconds
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                return
            try:
                msg = await self.ws.receive(timeout=left)
            except asyncio.TimeoutError:
                return
            recv = now_ms()
            if msg.type == aiohttp.WSMsgType.PING:
                self.pings.append(recv)
                await self.ws.pong(msg.data)
                print(f"  server ping at {iso(recv)}, {recv - self.opened_at} ms after open, payload {msg.data!r}")
                continue
            if msg.type == aiohttp.WSMsgType.PONG:
                yield recv, "pong-frame", msg.data
                continue
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.CLOSING):
                print(f"  close at {iso(recv)}: type {msg.type}, code {self.ws.close_code}, extra {msg.extra!r}")
                yield recv, "close", msg.data
                return
            if msg.type == aiohttp.WSMsgType.ERROR:
                print(f"  error frame: {msg.data!r}")
                return
            if msg.type == aiohttp.WSMsgType.BINARY:
                yield recv, "binary", msg.data
                continue
            yield recv, "text", msg.data


async def mode_books(seconds: float) -> None:
    names = perp_names()
    print(f"## books, {len(names)} perps, {seconds:.0f} s")
    books = [f"orderbook.{n}.1.20" for n in names]
    tickers = [f"ticker_slim.{n}.1000" for n in names]
    book = {n: {"recv": [], "pid": [], "age": [], "bids": [], "asks": [], "same": 0, "crossed": 0, "one_sided": 0, "empty": 0, "unordered": 0, "bytes": [], "last": None} for n in names}
    tick = {n: {"recv": [], "age": [], "last": None, "changes": {"I": 0, "M": 0, "f": 0}} for n in names}
    spot = {"recv": [], "sample": None}
    global_pids = []
    async with Socket(V3_WS) as s:
        rid = await s.rpc("subscribe", {"channels": books + tickers + ["spot_feed.BTC"]})
        sub_sent = now_ms()
        first_book_at = {}
        saved = set()
        async for recv, kind, payload in s.frames(seconds):
            if kind != "text":
                print(f"  {kind} frame at {iso(recv)}: {payload!r}"[:300])
                continue
            msg = json.loads(payload)
            if msg.get("id") == rid:
                status = msg.get("result", {}).get("status", {})
                print(f"subscribe ack after {recv - sub_sent} ms: {len(status)} statuses, values {sorted(set(status.values()))}, keys {sorted(msg.get('result', {}).keys())}")
                save("ws_ack_books.json", msg)
                continue
            if msg.get("method") != "subscription":
                print(f"  other frame: {payload[:300]}")
                continue
            ch = msg["params"]["channel"]
            data = msg["params"]["data"]
            if ch.startswith("orderbook."):
                n = data["instrument_name"]
                b = book[n]
                if n not in first_book_at:
                    first_book_at[n] = recv - sub_sent
                if "orderbook" not in saved:
                    save("ws_orderbook_frame.json", msg)
                    saved.add("orderbook")
                b["recv"].append(recv)
                b["pid"].append(data["publish_id"])
                global_pids.append((recv, n, data["publish_id"]))
                b["age"].append(recv - int(data["timestamp"]))
                b["bytes"].append(len(payload))
                bids, asks = data["bids"], data["asks"]
                b["bids"].append(len(bids))
                b["asks"].append(len(asks))
                if not bids and not asks:
                    b["empty"] += 1
                elif not bids or not asks:
                    b["one_sided"] += 1
                if bids and asks and float(bids[0][0]) >= float(asks[0][0]):
                    b["crossed"] += 1
                bp = [float(x[0]) for x in bids]
                ap = [float(x[0]) for x in asks]
                if bp != sorted(bp, reverse=True) or ap != sorted(ap):
                    b["unordered"] += 1
                if b["last"] == (bids, asks):
                    b["same"] += 1
                b["last"] = (bids, asks)
            elif ch.startswith("ticker_slim."):
                n = ch.split(".")[1]
                t = tick[n]
                inner = data.get("instrument_ticker", data)
                if "ticker" not in saved:
                    save("ws_ticker_slim_frame.json", msg)
                    saved.add("ticker")
                    print(f"ticker_slim data keys: {sorted(data.keys())}, inner keys {sorted(inner.keys())}")
                t["recv"].append(recv)
                t["age"].append(recv - int(inner["t"]))
                if t["last"]:
                    for k in t["changes"]:
                        if inner.get(k) != t["last"].get(k):
                            t["changes"][k] += 1
                t["last"] = inner
            elif ch.startswith("spot_feed."):
                spot["recv"].append(recv)
                if spot["sample"] is None:
                    spot["sample"] = msg
                    save("ws_spot_feed_frame.json", msg)
            else:
                print(f"  unexpected channel {ch}")
        print(f"server pings: {len(s.pings)} at ms after open {[p - s.opened_at for p in s.pings]}")
    print(f"first book after subscribe, ms: {stats(sorted(first_book_at.values()))}")
    print("orderbook.{name}.1.20 per perp:")
    all_gaps, all_ages = [], []
    for n in names:
        b = book[n]
        gaps = [y - x for x, y in zip(b["recv"], b["recv"][1:])]
        steps = [y - x for x, y in zip(b["pid"], b["pid"][1:])]
        all_gaps += gaps
        all_ages += b["age"]
        print(
            f"  {n}: frames {len(b['recv'])}, gap ms {stats(gaps)}, publish_id step min {min(steps) if steps else None} max {max(steps) if steps else None} "
            f"non-increasing {sum(1 for x in steps if x <= 0)}, age ms p50 {pct(b['age'], 0.5)} max {max(b['age']) if b['age'] else None}, "
            f"levels bid {min(b['bids'], default=None)}-{max(b['bids'], default=None)} ask {min(b['asks'], default=None)}-{max(b['asks'], default=None)}, "
            f"same as previous {b['same']}, crossed {b['crossed']}, one-sided {b['one_sided']}, empty {b['empty']}, unordered {b['unordered']}, bytes max {max(b['bytes'], default=None)}"
        )
    print(f"all books, gap ms: {stats(all_gaps)}")
    print(f"all books, age of timestamp at arrival ms: {stats(all_ages)}")
    by_pid = sorted(global_pids, key=lambda x: x[2])
    shared = len({p for _, _, p in global_pids}) < len(global_pids)
    print(f"publish_id shared across perps: {shared}, first {by_pid[:3]}, last {by_pid[-3:]}")
    print("ticker_slim.{name}.1000 per perp:")
    all_t = []
    for n in names:
        t = tick[n]
        gaps = [y - x for x, y in zip(t["recv"], t["recv"][1:])]
        all_t += t["age"]
        print(f"  {n}: frames {len(t['recv'])}, gap ms p50 {pct(gaps, 0.5)} max {max(gaps) if gaps else None}, age of t ms p50 {pct(t['age'], 0.5)} max {max(t['age']) if t['age'] else None}, changes {t['changes']}")
    print(f"all tickers, age of t at arrival ms: {stats(all_t)}, share over 10 s {sum(1 for a in all_t if a > 10000) / max(1, len(all_t)):.3f}")
    gaps = [y - x for x, y in zip(spot["recv"], spot["recv"][1:])]
    print(f"spot_feed.BTC: frames {len(spot['recv'])}, gap ms {stats(gaps)}, sample {json.dumps(spot['sample'])[:400] if spot['sample'] else None}")


async def mode_group(seconds: float) -> None:
    print(f"## group, {seconds:.0f} s")
    chans = [f"orderbook.BTC-PERP.{g}.{d}" for g, d in [(1, 1), (1, 10), (1, 20), (1, 100), (10, 20), (100, 20)]] + ["orderbook.ETH-PERP.1.20", "orderbook.ETH-PERP.10.20"]
    seen = {c: {"recv": [], "bids": [], "asks": [], "step": [], "first": None} for c in chans}
    async with Socket(V3_WS) as s:
        rid = await s.rpc("subscribe", {"channels": chans})
        async for recv, kind, payload in s.frames(seconds):
            if kind != "text":
                continue
            msg = json.loads(payload)
            if msg.get("id") == rid:
                print(f"ack: {msg.get('result', msg.get('error'))}")
                continue
            ch = msg.get("params", {}).get("channel")
            if ch not in seen:
                continue
            d = msg["params"]["data"]
            x = seen[ch]
            x["recv"].append(recv)
            x["bids"].append(len(d["bids"]))
            x["asks"].append(len(d["asks"]))
            bp = [float(b[0]) for b in d["bids"]]
            if len(bp) > 1:
                x["step"].append(round(min(a - b for a, b in zip(bp, bp[1:])), 8))
            if x["first"] is None:
                x["first"] = d
    for c in chans:
        x = seen[c]
        gaps = [y - a for a, y in zip(x["recv"], x["recv"][1:])]
        f = x["first"] or {}
        print(f"  {c}: frames {len(x['recv'])}, gap ms p50 {pct(gaps, 0.5)} max {max(gaps) if gaps else None}, levels bid {min(x['bids'], default=None)}-{max(x['bids'], default=None)} ask {min(x['asks'], default=None)}-{max(x['asks'], default=None)}, smallest bid step {min(x['step']) if x['step'] else None}, first bids {f.get('bids', [])[:3]}, first asks {f.get('asks', [])[:3]}")


async def mode_edge(seconds: float) -> None:
    print("## edge")
    async with Socket(V3_WS) as s:
        cases = [
            ("subscribe", {"channels": ["orderbook.NOPE-PERP.1.20"]}),
            ("subscribe", {"channels": ["orderbook.BTC-PERP.1.20", "orderbook.BTC-PERP.2.20", "orderbook.BTC-PERP.1.50", "orderbook.btc-perp.1.20"]}),
            ("subscribe", {"channels": ["ticker.BTC-PERP.1000"]}),
            ("subscribe", {"channels": ["orderbook.BTC-PERP.1.20"]}),
            ("public/get_time", {}),
            ("public/no_such_method", {}),
            ("unsubscribe", {"channels": ["orderbook.BTC-PERP.1.20"]}),
        ]
        for method, params in cases:
            rid = await s.rpc(method, params)
            sent = now_ms()
            async for recv, kind, payload in s.frames(3):
                if kind == "text":
                    msg = json.loads(payload)
                    if msg.get("id") == rid:
                        print(f"{method} {params}: after {recv - sent} ms, reply {payload[:500]}")
                        break
        await s.ws.send_str("ping")
        sent = now_ms()
        async for recv, kind, payload in s.frames(3):
            if kind == "text" and not payload.startswith("{"):
                print(f"text ping: reply {payload!r} after {recv - sent} ms")
                break
        await s.ws.ping(b"probe")
        sent = now_ms()
        async for recv, kind, payload in s.frames(3):
            if kind == "pong-frame":
                print(f"protocol ping: pong frame after {recv - sent} ms, payload {payload!r}")
                break
        await s.ws.send_str("{not json")
        sent = now_ms()
        async for recv, kind, payload in s.frames(3):
            print(f"malformed JSON: {kind} after {recv - sent} ms, {payload[:300] if isinstance(payload, str) else payload!r}")
            break
        await s.ws.send_str(json.dumps({"method": "subscribe", "params": {"channels": ["orderbook.ETH-PERP.1.20"]}}))
        sent = now_ms()
        async for recv, kind, payload in s.frames(3):
            print(f"subscribe without id: {kind} after {recv - sent} ms, {payload[:300] if isinstance(payload, str) else payload!r}")
            break
        rest = max(5.0, seconds - (now_ms() - s.opened_at) / 1000)
        per_channel = {}
        async for recv, kind, payload in s.frames(rest):
            if kind != "text":
                print(f"  {kind} at {iso(recv)}")
                continue
            ch = json.loads(payload).get("params", {}).get("channel", "reply")
            per_channel[ch] = per_channel.get(ch, 0) + 1
        print(f"data frames per channel over the last {rest:.0f} s, with NOPE-PERP, btc-perp and ETH-PERP subscribed: {per_channel}")
        print(f"server pings: {len(s.pings)}")
    async with Socket(V3_WS, compress=15) as s:
        print(f"deflate offered: server answered extensions {s.headers.get('Sec-WebSocket-Extensions')!r}")


async def mode_legacy(seconds: float) -> None:
    print(f"## legacy, {seconds:.0f} s")
    try:
        async with Socket(V2_WS) as s:
            await legacy_read(s, seconds)
    except aiohttp.WSServerHandshakeError as e:
        r = httpx.get("https://api.lyra.finance/ws", headers={"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}, timeout=15)
        print(f"v2 handshake refused: status {e.status}, message {e.message!r}, body by a plain GET {r.status_code} {r.text.strip()[:200]!r}")


async def legacy_read(s, seconds: float) -> None:
    if True:
        rid = await s.rpc("subscribe", {"channels": ["orderbook.BTC-PERP.1.20", "ticker.BTC-PERP.1000"]})
        counts = {}
        first = {}
        async for recv, kind, payload in s.frames(seconds):
            if kind != "text":
                continue
            msg = json.loads(payload)
            if msg.get("id") == rid:
                print(f"ack: {payload[:400]}")
                continue
            ch = msg.get("params", {}).get("channel")
            counts[ch] = counts.get(ch, 0) + 1
            if ch not in first:
                first[ch] = msg["params"]["data"]
        print(f"frames per channel: {counts}")
        for ch, d in first.items():
            if ch.startswith("orderbook"):
                print(f"  {ch}: timestamp {d.get('timestamp')}, age ms {now_ms() - int(d.get('timestamp', 0))}, bids {d['bids'][:3]}, asks {d['asks'][:3]}")
            else:
                inner = d.get("instrument_ticker", d)
                print(f"  {ch}: index {inner.get('index_price')}, mark {str(inner.get('mark_price'))[:12]}, timestamp {inner.get('timestamp')}")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "books"
    seconds = float(sys.argv[2]) if len(sys.argv) > 2 else {"books": 170, "group": 30, "edge": 25, "legacy": 12}[mode]
    print(f"# derive ws-probe {mode} at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    fn = {"books": mode_books, "group": mode_group, "edge": mode_edge, "legacy": mode_legacy}[mode]
    asyncio.run(fn(seconds))
    print(f"# done at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")


if __name__ == "__main__":
    main()
