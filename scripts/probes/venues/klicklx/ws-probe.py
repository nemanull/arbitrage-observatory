# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13", "msgpack>=1.0"]
# ///
"""KlicklX perpetual market socket probe for docs/profiles/klicklx/websocket.md.

The futures website talks ASP.NET Core SignalR to wss://ctws.klicklx.com/senders.
It skips negotiation, uses the WebSocket transport and the MessagePack hub protocol, and joins one group per contract.
This probe does the same, public and unauthenticated, and only invokes AddToGroup, SetTickSize and RemoveFromGroup.
Total socket time is about two and a half minutes.
Run from the repository root with: uv run scripts/probes/venues/klicklx/ws-probe.py
Raw captures go to .claude/survey-work/klicklx/ws-*.json.
"""

import asyncio
import collections
import json
import pathlib
import time
import urllib.request

import msgpack
import websockets

URL = "wss://ctws.klicklx.com/senders"
REST = "https://ctapi.klicklx.com/api"
RS = b"\x1e"
OUT = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "klicklx"


def post(path: str, form: str = "") -> dict:
    req = urllib.request.Request(f"{REST}/{path}", data=form.encode(), method="POST",
                                 headers={"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)",
                                          "Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def frame(msg: list) -> bytes:
    body = msgpack.packb(msg, use_bin_type=True)
    return varint(len(body)) + body


def unframe(data: bytes) -> list:
    """Split one binary WebSocket frame into SignalR MessagePack messages."""
    msgs, i = [], 0
    while i < len(data):
        n, shift = 0, 0
        while True:
            b = data[i]
            i += 1
            n |= (b & 0x7F) << shift
            shift += 7
            if not b & 0x80:
                break
        msgs.append(msgpack.unpackb(data[i:i + n], raw=False, strict_map_key=False))
        i += n
    return msgs


class Hub:
    def __init__(self, protocol: str = "messagepack"):
        self.protocol = protocol
        self.ws = None
        self.inv = 0
        self.pending: dict[str, asyncio.Future] = {}
        self.events: list[tuple[float, str, list]] = []
        self.pings: list[float] = []
        self.close: list | None = None
        self.raw_first: dict[str, str] = {}

    async def open(self):
        t0 = time.perf_counter()
        self.ws = await websockets.connect(URL, max_size=None, compression=None, open_timeout=20,
                                           ping_interval=None,
                                           user_agent_header="Mozilla/5.0 (arbitrage-observatory-probe/1.0)")
        t1 = time.perf_counter()
        await self.ws.send(json.dumps({"protocol": self.protocol, "version": 1}) + "\x1e")
        first = await asyncio.wait_for(self.ws.recv(), 20)
        t2 = time.perf_counter()
        raw = first if isinstance(first, bytes) else first.encode()
        head, _, rest = raw.partition(RS)
        hs = {"connect_ms": round((t1 - t0) * 1000), "handshake_ms": round((t2 - t1) * 1000),
              "handshake_reply": head.decode(errors="replace"),
              "frame_type": "binary" if isinstance(first, bytes) else "text",
              "extensions": self.ws.response.headers.get("Sec-WebSocket-Extensions")}
        if rest and self.protocol == "messagepack":
            for m in unframe(rest):
                self._dispatch(m)
        self.reader = asyncio.create_task(self._read())
        return hs

    def _dispatch(self, m):
        now = time.time()
        if isinstance(m, dict):  # JSON protocol
            kind = m.get("type")
            if kind == 1:
                self.events.append((now, m["target"], m.get("arguments", [])))
            elif kind == 3:
                f = self.pending.pop(m.get("invocationId"), None)
                if f and not f.done():
                    f.set_result(m)
            elif kind == 6:
                self.pings.append(now)
            elif kind == 7:
                self.close = [7, m.get("error"), m.get("allowReconnect")]
            return
        kind = m[0]
        if kind == 1:
            self.events.append((now, m[3], m[4]))
        elif kind == 3:
            f = self.pending.pop(m[2], None)
            if f and not f.done():
                f.set_result(m)
        elif kind == 6:
            self.pings.append(now)
        elif kind == 7:
            self.close = m

    async def _read(self):
        try:
            async for data in self.ws:
                if self.protocol == "messagepack":
                    for m in unframe(data):
                        self._dispatch(m)
                else:
                    for part in data.split("\x1e"):
                        if part:
                            self._dispatch(json.loads(part))
        except websockets.ConnectionClosed as e:
            self.closed_at = time.time()
            self.close_code = (e.rcvd.code if e.rcvd else None, e.rcvd.reason if e.rcvd else None)

    async def invoke(self, target: str, *args):
        self.inv += 1
        iid = str(self.inv)
        fut = asyncio.get_running_loop().create_future()
        self.pending[iid] = fut
        t0 = time.perf_counter()
        if self.protocol == "messagepack":
            await self.ws.send(frame([1, {}, iid, target, list(args), []]))
        else:
            await self.ws.send(json.dumps({"type": 1, "invocationId": iid, "target": target,
                                           "arguments": list(args)}) + "\x1e")
        try:
            res = await asyncio.wait_for(fut, 15)
        except asyncio.TimeoutError:
            return {"target": target, "args": list(args), "result": "no completion in 15 s"}
        ms = round((time.perf_counter() - t0) * 1000)
        return {"target": target, "args": list(args), "completion": res, "ms": ms}

    async def ping(self):
        if self.protocol == "messagepack":
            await self.ws.send(frame([6]))
        else:
            await self.ws.send('{"type":6}\x1e')

    async def keepalive(self, every: float):
        while True:
            await asyncio.sleep(every)
            await self.ping()


def summarize(events):
    counts = collections.Counter(t for _, t, _ in events)
    return dict(counts)


def book_stats(events, cid):
    """Inspect the order book pushes of one contract."""
    snaps = [(ts, a) for ts, t, a in events if t == "ShowOrderBooksAsync"]
    deltas = [(ts, a) for ts, t, a in events if t == "HandleOrderBooksChangedAsync"]
    out = {"snapshots": len(snaps), "deltas": len(deltas)}
    if snaps:
        gaps = [round(snaps[i][0] - snaps[i - 1][0], 3) for i in range(1, len(snaps))]
        out["snapshot_gap_s"] = {"min": min(gaps), "max": max(gaps), "median": sorted(gaps)[len(gaps) // 2]} if gaps else None
        first = snaps[0][1][0]
        out["snapshot_first_keys"] = sorted(first.keys()) if isinstance(first, dict) else type(first).__name__
        levels = []
        same = 0
        prev = None
        for _, a in snaps:
            d = a[0]
            if isinstance(d, dict):
                bids = d.get("Bids") or d.get("bids") or []
                asks = d.get("Asks") or d.get("asks") or []
                levels.append((len(bids), len(asks)))
                key = json.dumps([bids, asks], sort_keys=True, default=str)
                same += key == prev
                prev = key
        if levels:
            out["levels_bids_asks_min"] = [min(l[0] for l in levels), min(l[1] for l in levels)]
            out["levels_bids_asks_max"] = [max(l[0] for l in levels), max(l[1] for l in levels)]
        out["snapshot_identical_to_previous"] = same
        order_ok = 0
        crossed = 0
        for _, a in snaps:
            d = a[0]
            bids = [float(x[0]) for x in d.get("Bids", [])]
            asks = [float(x[0]) for x in d.get("Asks", [])]
            order_ok += bids == sorted(bids, reverse=True) and asks == sorted(asks)
            crossed += bool(bids and asks and bids[0] >= asks[0])
        out["snapshots_bids_desc_asks_asc"] = order_ok
        out["snapshots_crossed"] = crossed
        out["snapshot_top"] = {"bid": snaps[-1][1][0]["Bids"][:2], "ask": snaps[-1][1][0]["Asks"][:2]}
    if deltas:
        out["delta_action_side"] = dict(collections.Counter(f"{a[0]}/{a[1]}" for _, a in deltas))
        out["delta_first"] = deltas[0][1]
    return out


async def mode_main(contracts, ticks):
    """One connection, one group, the website sequence, 40 s of pushes with a client ping every 15 s."""
    h = Hub()
    hs = await h.open()
    btc = contracts["BTCUSDT"]
    add = await h.invoke("AddToGroup", btc)
    # The hub binds the tick size as a .NET decimal, which MessagePack carries as a string.
    tick = await h.invoke("SetTickSize", btc, str(ticks["BTCUSDT"]))
    ka = asyncio.create_task(h.keepalive(15))
    t0 = time.time()
    await asyncio.sleep(40)
    ka.cancel()
    remove = await h.invoke("RemoveFromGroup", btc)
    n_before = len(h.events)
    await asyncio.sleep(5)
    after_remove = summarize(h.events[n_before:])
    await h.ws.close()
    first_by_target = {}
    for ts, t, a in h.events:
        first_by_target.setdefault(t, {"t": round(ts - t0, 3), "args": a})
    res = {"handshake": hs, "add": add, "settick": tick, "remove": remove,
           "events_40s": summarize([e for e in h.events[:n_before]]),
           "after_remove_5s": after_remove,
           "server_pings": len(h.pings),
           "server_ping_gaps_s": [round(h.pings[i] - h.pings[i - 1], 2) for i in range(1, len(h.pings))],
           "book": book_stats(h.events[:n_before], btc),
           "first_by_target": first_by_target}
    (OUT / "ws-main.json").write_text(json.dumps(res, indent=1, default=str))
    # full stream of the first 40 events, for the frames section
    (OUT / "ws-main-stream.json").write_text(json.dumps(
        [{"t": round(ts - t0, 3), "target": t, "args": a} for ts, t, a in h.events[:40]], indent=1, default=str))
    return res


async def mode_multi(contracts, ticks):
    """Three groups on one connection, without RemoveFromGroup, 15 s."""
    h = Hub()
    await h.open()
    names = ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
    adds = [await h.invoke("AddToGroup", contracts[n]) for n in names]
    sets = [await h.invoke("SetTickSize", contracts[n], str(ticks[n])) for n in names]
    ka = asyncio.create_task(h.keepalive(15))
    await asyncio.sleep(15)
    ka.cancel()
    await h.ws.close()
    per = collections.Counter()
    for _, t, a in h.events:
        if t == "ShowOrderBooksAsync" and a and isinstance(a[0], dict):
            per[str(a[0].get("ContractId") or a[0].get("contractId"))] += 1
        if t == "ShowRealTimeHandicapAsync" and a and isinstance(a[0], dict):
            per["ticker:" + str(a[0].get("ContractId") or a[0].get("Symbol"))] += 1
    res = {"adds": adds, "settick": sets, "events": summarize(h.events), "book_and_ticker_by_contract": dict(per),
           "ids": {n: contracts[n] for n in names}}
    (OUT / "ws-multi.json").write_text(json.dumps(res, indent=1, default=str))
    return res


async def mode_errors(contracts):
    """Unknown contract id, a symbol name instead of an id, an unknown hub method, and the JSON protocol."""
    h = Hub()
    await h.open()
    unknown = await h.invoke("AddToGroup", "123")
    by_name = await h.invoke("AddToGroup", "BTCUSDT")
    bad_method = await h.invoke("Subscribe", contracts["BTCUSDT"])
    await asyncio.sleep(5)
    ev = summarize(h.events)
    btc = contracts["BTCUSDT"]
    await h.invoke("AddToGroup", btc)
    tick_float = await h.invoke("SetTickSize", btc, 10.0)
    tick_str = await h.invoke("SetTickSize", btc, "10")
    n0 = len(h.events)
    await asyncio.sleep(4)
    agg = [a[0] for _, t, a in h.events[n0:] if t == "ShowOrderBooksAsync"]
    agg_prices = [x[0] for x in agg[-1]["Bids"][:5]] if agg else None
    agg_levels = [len(agg[-1]["Bids"]), len(agg[-1]["Asks"])] if agg else None
    await h.ws.close()
    j = Hub("json")
    try:
        jhs = await j.open()
        jadd = await j.invoke("AddToGroup", contracts["BTCUSDT"])
        await asyncio.sleep(5)
        jev = summarize(j.events)
        jfirst = next((a for _, t, a in j.events if t == "ShowOrderBooksAsync"), None)
        await j.ws.close()
    except Exception as e:  # noqa: BLE001
        jhs, jadd, jev, jfirst = repr(e), None, None, None
    res = {"unknown_id": unknown, "symbol_name": by_name, "bad_method": bad_method, "events_5s": ev,
           "settick_float": tick_float, "settick_string_10": tick_str,
           "book_after_tick_10_top5_bids": agg_prices, "book_after_tick_10_levels": agg_levels,
           "json_handshake": jhs, "json_add": jadd, "json_events_5s": jev,
           "json_first_book": json.dumps(jfirst, default=str)[:600] if jfirst else None}
    (OUT / "ws-errors.json").write_text(json.dumps(res, indent=1, default=str))
    return res


async def mode_silence(contracts):
    """Join one group, never send a client ping, and wait up to 60 s for the server to close."""
    h = Hub()
    await h.open()
    await h.invoke("AddToGroup", contracts["BTCUSDT"])
    t0 = time.time()
    while time.time() - t0 < 60 and not h.reader.done():
        await asyncio.sleep(0.5)
    res = {"closed": h.reader.done(), "after_s": round(getattr(h, "closed_at", time.time()) - t0, 1),
           "close_message": h.close, "close_code": getattr(h, "close_code", None),
           "server_pings": len(h.pings)}
    if not h.reader.done():
        await h.ws.close()
    (OUT / "ws-silence.json").write_text(json.dumps(res, indent=1, default=str))
    return res


async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    cat = post("baseinfo/GetContracts")["data"]
    contracts = {c["name"]: c["id"] for c in cat}
    ticks = {c["name"]: c["tickSize"][0] for c in cat}
    for name, fn in [("main", lambda: mode_main(contracts, ticks)),
                     ("multi", lambda: mode_multi(contracts, ticks)),
                     ("errors", lambda: mode_errors(contracts)),
                     ("silence", lambda: mode_silence(contracts))]:
        print(f"== {name}")
        res = await fn()
        print(json.dumps(res, indent=1, default=str)[:4000])


if __name__ == "__main__":
    asyncio.run(main())
