# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9", "httpx>=0.27"]
# ///
"""Read-only probe of the Paradex public WebSocket, wss://ws.api.prod.paradex.trade/v1.

Public channel payloads are SBE binary frames since 2026-09-21, so this script carries a small decoder for the public templates of the schema paradex_1_0.xml.
Modes: encoding (about 35 s), book (45 s), batch (45 s), anchor (50 s), errors (15 s), silence (75 s), and all of them in turn by default, about four and a half minutes of socket time.
Nothing here authenticates, and only public channels are subscribed.
Run from the repository root: uv run scripts/probes/venues/paradex/ws-probe.py [mode]
Captures go to .claude/survey-work/paradex/.
"""

import asyncio
import collections
import json
import statistics
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
import httpx

WORK = Path(".claude/survey-work/paradex")
BASE = "wss://ws.api.prod.paradex.trade/v1"
SBE = BASE + "?sbeSchemaId=1&sbeSchemaVersion=1"
API = "https://api.prod.paradex.trade/v1"
NULL = -(2**63)
E8 = 1e-8
E12 = 1e-12

# Root block fields per template in schema order, as (name, kind), where kind sets the width and the scale.
TEMPLATES = {
    1: ("TradeEvent", [("ts", "ts"), ("seq", "i64"), ("tradeId", "i64"), ("side", "u8"), ("price", "p8"), ("size", "p8"), ("createdAt", "ts"), ("tradeType", "u8")], [], ["market", "tradeIdStr"]),
    2: ("BboEvent", [("ts", "ts"), ("seq", "i64"), ("bidPrice", "p8"), ("bidSize", "p8"), ("askPrice", "p8"), ("askSize", "p8")], [], ["market"]),
    3: ("BookEvent", [("ts", "ts"), ("seq", "i64"), ("pkgType", "u8"), ("bestBidPrice", "p8"), ("bestBidSize", "p8"), ("bestAskPrice", "p8"), ("bestAskSize", "p8"), ("relativeSpread", "p8"), ("bestBidApiPrice", "p8"), ("bestBidApiSize", "p8"), ("bestAskApiPrice", "p8"), ("bestAskApiSize", "p8")], ["bids", "asks"], ["market"]),
    4: ("MarketSummaryEvent", [("ts", "ts"), ("seq", "i64"), ("markPrice", "p8"), ("indexPrice", "p8"), ("lastPrice", "p8"), ("volumeUsd24h", "p8"), ("openInterest", "p8"), ("fundingRate", "p8"), ("bid", "p8"), ("ask", "p8"), ("totalVolume", "p8"), ("priceChangeRate24h", "p8"), ("markIv", "p8"), ("bidIv", "p8"), ("askIv", "p8"), ("lastIv", "p8"), ("delta", "p8"), ("gamma", "p8"), ("vega", "p8"), ("theta", "p8"), ("rho", "p8"), ("volga", "p8"), ("vanna", "p8"), ("futureFundingRate", "p8"), ("externalFairPrice", "p8"), ("bidSize", "p8"), ("askSize", "p8"), ("forwardRate", "p8"), ("riskFreeRate", "p8"), ("fundingRatePrecise", "p12")], [], ["market"]),
    5: ("FundingDataEvent", [("ts", "ts"), ("seq", "i64"), ("fundingRate", "p8"), ("fundingIndex", "p8"), ("createdAt", "ts"), ("fundingPremium", "p8"), ("fundingRate8h", "p8"), ("fundingPeriodHours", "i16"), ("impactPremiumRate", "p8")], [], ["market"]),
    40: ("HeartbeatEvent", [("ts", "ts"), ("seq", "i64")], [], []),
}
WIDTH = {"ts": 8, "i64": 8, "p8": 8, "p12": 8, "u8": 1, "i16": 2}


def decode(frame: bytes) -> dict:
    block_length, template, schema, version = struct.unpack_from("<HHHH", frame, 0)
    out = {"_template": template, "_block": block_length, "_schema": schema, "_version": version, "_bytes": len(frame)}
    spec = TEMPLATES.get(template)
    if spec is None:
        out["_unknown"] = True
        return out
    name, fields, groups, datas = spec
    out["_name"] = name
    offset = 8
    for field, kind in fields:
        width = WIDTH[kind]
        if offset - 8 + width > block_length:
            break  # the field is newer than the negotiated version
        if kind in ("ts", "i64", "p8", "p12"):
            (raw,) = struct.unpack_from("<q", frame, offset)
            if kind == "p8":
                out[field] = None if raw == NULL else raw * E8
            elif kind == "p12":
                out[field] = None if raw == NULL else raw * E12
            else:
                out[field] = raw
        elif kind == "u8":
            out[field] = frame[offset]
        elif kind == "i16":
            (out[field],) = struct.unpack_from("<h", frame, offset)
        offset += width
    offset = 8 + block_length
    for group in groups:
        group_block, count = struct.unpack_from("<HH", frame, offset)
        offset += 4
        levels = []
        for _ in range(count):
            price, size = struct.unpack_from("<qq", frame, offset)
            levels.append((price * E8, size * E8, price, size))
            offset += group_block
        out[group] = levels
    for data in datas:
        if offset >= len(frame):
            break
        length = frame[offset]
        out[data] = frame[offset + 1 : offset + 1 + length].decode()
        offset += 1 + length
    out["_trailing"] = len(frame) - offset
    return out


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def now_ms() -> float:
    return time.time_ns() / 1e6


def quantiles(values):
    values = sorted(values)
    if not values:
        return {}
    def q(p):
        return values[min(len(values) - 1, int(p * (len(values) - 1) + 0.5))]
    return {"n": len(values), "min": round(values[0], 1), "p50": round(q(0.5), 1), "p90": round(q(0.9), 1), "p99": round(q(0.99), 1), "max": round(values[-1], 1)}


def sub(channel: str, ident: int) -> str:
    return json.dumps({"jsonrpc": "2.0", "method": "subscribe", "params": {"channel": channel}, "id": ident})


def save(name: str, data) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(data, indent=1, default=str))


class Capture:
    """One socket's frames, text and binary, with arrival times."""

    def __init__(self, label: str):
        self.label = label
        self.text = []
        self.binary = []
        self.pings = []
        self.close = None
        self.opened = None
        self.handshake = None
        self.opened_at = None
        self.raw = collections.defaultdict(list)

    def summary(self) -> str:
        templates = collections.Counter(f["_template"] for _, f in self.binary)
        return f"{self.label}: text={len(self.text)} binary={len(self.binary)} templates={dict(templates)} pings={len(self.pings)} close={self.close}"


async def run_socket(session, url, frames, seconds, label, autoping=True, answer_pings=True, gap=0.0, on_frame=None, compress=0):
    cap = Capture(label)
    t0 = time.perf_counter()
    try:
        ws = await session.ws_connect(url, autoping=autoping, compress=compress, max_msg_size=0, heartbeat=None)
    except aiohttp.WSServerHandshakeError as error:
        cap.handshake = {"status": error.status, "message": error.message, "headers": dict(error.headers or {})}
        return cap
    cap.opened = round((time.perf_counter() - t0) * 1000, 1)
    cap.opened_at = now_ms()
    cap.handshake = {"status": ws._response.status, "headers": {k: v for k, v in ws._response.headers.items() if k.lower() in ("sec-websocket-extensions", "server", "via", "x-amz-cf-pop", "date", "sec-websocket-protocol")}}
    for frame in frames:
        await ws.send_str(frame)
        if gap:
            await asyncio.sleep(gap)
    deadline = time.perf_counter() + seconds
    try:
        while True:
            left = deadline - time.perf_counter()
            if left <= 0:
                break
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=left)
            except asyncio.TimeoutError:
                break
            arrived = now_ms()
            if msg.type == aiohttp.WSMsgType.BINARY:
                decoded = decode(msg.data)
                cap.binary.append((arrived, decoded))
                key = f"{decoded['_template']}/{decoded.get('pkgType', '-')}"
                if len(cap.raw[key]) < 2 and len(msg.data) <= 700:
                    cap.raw[key].append({"hex": msg.data.hex(), "decoded": {k: v for k, v in decoded.items() if k not in ("bids", "asks")} | {"bids": [l[:2] for l in decoded.get("bids", [])][:3], "asks": [l[:2] for l in decoded.get("asks", [])][:3]}})
                if on_frame:
                    on_frame(arrived, decoded, len(msg.data))
            elif msg.type == aiohttp.WSMsgType.TEXT:
                cap.text.append((arrived, msg.data))
            elif msg.type == aiohttp.WSMsgType.PING:
                cap.pings.append(round(time.perf_counter() - t0, 2))
                if answer_pings:
                    await ws.pong(msg.data)
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                cap.close = {"type": str(msg.type), "data": msg.data, "extra": msg.extra, "at_s": round(time.perf_counter() - t0, 2), "code": ws.close_code}
                break
    finally:
        if not ws.closed:
            await ws.close()
    return cap


async def mode_encoding() -> None:
    print(f"== encoding {utc()}")
    upgrade = {"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
    async with httpx.AsyncClient(timeout=20, http2=False) as client:
        for url in (BASE, BASE + "?sbeSchemaId=1&sbeSchemaVersion=9"):
            r = await client.get(url.replace("wss://", "https://"), headers=upgrade)
            print(f"upgrade request to {url}: status={r.status_code} type={r.headers.get('content-type')} body={r.text[:400]!r}")
    frames = [sub("order_book.BTC-USD-PERP.snapshot@15@100ms", 1), sub("bbo.BTC-USD-PERP", 2), sub("markets_summary.BTC-USD-PERP", 3)]
    async with aiohttp.ClientSession() as session:
        for label, url, compress in [
            ("plain URL, no SBE parameters", BASE, 0),
            ("sbeSchemaVersion=0", BASE + "?sbeSchemaId=1&sbeSchemaVersion=0", 0),
            ("sbeSchemaVersion=1", SBE, 0),
            ("sbeSchemaVersion=2", BASE + "?sbeSchemaId=1&sbeSchemaVersion=2", 0),
            ("sbeSchemaVersion=3", BASE + "?sbeSchemaId=1&sbeSchemaVersion=3", 0),
            ("sbeSchemaId=2", BASE + "?sbeSchemaId=2&sbeSchemaVersion=0", 0),
            ("sbeSchemaVersion=1 offering permessage-deflate", SBE, 15),
        ]:
            cap = await run_socket(session, url, frames, 4, label, compress=compress)
            print(cap.summary(), "opened ms", cap.opened, "handshake", cap.handshake)
            for arrived, text in cap.text[:4]:
                print("   text:", text[:300])
            blocks = collections.Counter((f["_template"], f["_block"], f["_version"]) for _, f in cap.binary)
            print("   (template, blockLength, version) counts:", dict(blocks))
            for _, f in cap.binary[:1]:
                print("   first binary:", {k: v for k, v in f.items() if k not in ("bids", "asks")}, "bids", len(f.get("bids", [])), "asks", len(f.get("asks", [])))


class BookChecker:
    """Applies a deltas feed to a local book and remembers the top 15 at every sequence number."""

    def __init__(self):
        self.books = {}
        self.seq = {}
        self.at_seq = {}
        self.steps = collections.defaultdict(list)
        self.kinds = collections.defaultdict(collections.Counter)
        self.first_kind = {}
        self.entries = collections.defaultdict(list)
        self.max_depth = collections.defaultdict(int)
        self.crossed = collections.Counter()
        self.ages = collections.defaultdict(list)
        self.zero_in_snapshot = 0
        self.arrivals = collections.defaultdict(list)

    def on_frame(self, arrived, f, size):
        if f.get("_template") != 3:
            return
        market = f["market"]
        kind = "snapshot" if f["pkgType"] == 0 else "delta"
        self.kinds[market][kind] += 1
        self.first_kind.setdefault(market, kind)
        self.arrivals[market].append(arrived)
        self.ages[market].append(arrived - f["ts"] / 1000)
        if market in self.seq:
            self.steps[market].append(f["seq"] - self.seq[market])
        self.seq[market] = f["seq"]
        self.entries[market].append(len(f["bids"]) + len(f["asks"]))
        if kind == "snapshot":
            self.zero_in_snapshot += sum(1 for level in f["bids"] + f["asks"] if level[3] == 0)
            book = {"bids": {}, "asks": {}}
        else:
            book = self.books.setdefault(market, {"bids": {}, "asks": {}})
        for side in ("bids", "asks"):
            for price, size, raw_price, raw_size in f[side]:
                if raw_size == 0:
                    book[side].pop(raw_price, None)
                else:
                    book[side][raw_price] = raw_size
        self.books[market] = book
        bids = sorted(book["bids"].items(), reverse=True)
        asks = sorted(book["asks"].items())
        self.max_depth[market] = max(self.max_depth[market], len(bids), len(asks))
        if bids and asks and bids[0][0] >= asks[0][0]:
            self.crossed[market] += 1
        self.at_seq[(market, f["seq"])] = (tuple(bids[:15]), tuple(asks[:15]))


class SnapshotRecorder:
    def __init__(self):
        self.at_seq = {}
        self.kinds = collections.defaultdict(collections.Counter)
        self.arrivals = collections.defaultdict(list)
        self.repeats = collections.Counter()
        self.last_seq = {}
        self.levels = collections.defaultdict(list)
        self.order_ok = collections.Counter()
        self.ages = collections.defaultdict(list)
        self.api_fields = collections.Counter()
        self.interactive_fields = collections.Counter()
        self.samples = []

    def on_frame(self, arrived, f, size):
        if f.get("_template") != 3:
            return
        market = f["market"]
        self.kinds[market]["snapshot" if f["pkgType"] == 0 else "delta"] += 1
        self.arrivals[market].append(arrived)
        self.ages[market].append(arrived - f["ts"] / 1000)
        if self.last_seq.get(market) == f["seq"]:
            self.repeats[market] += 1
        self.last_seq[market] = f["seq"]
        bids = [(raw_p, raw_s) for _, _, raw_p, raw_s in f["bids"]]
        asks = [(raw_p, raw_s) for _, _, raw_p, raw_s in f["asks"]]
        self.levels[market].append((len(bids), len(asks)))
        if all(bids[i][0] > bids[i + 1][0] for i in range(len(bids) - 1)) and all(asks[i][0] < asks[i + 1][0] for i in range(len(asks) - 1)):
            self.order_ok[market] += 1
        if f.get("bestBidApiPrice") is not None or f.get("bestAskApiPrice") is not None:
            self.api_fields[market] += 1
        if f.get("bestBidPrice") is not None or f.get("bestAskPrice") is not None:
            self.interactive_fields[market] += 1
            if len(self.samples) < 3:
                self.samples.append({k: v for k, v in f.items() if k not in ("bids", "asks")} | {"top_bid": f["bids"][:1], "top_ask": f["asks"][:1]})
        self.at_seq[(market, f["seq"])] = (tuple(bids), tuple(asks))


def intervals(arrivals):
    return [arrivals[i + 1] - arrivals[i] for i in range(len(arrivals) - 1)]


async def mode_book() -> None:
    print(f"== book {utc()}")
    markets = ["BTC-USD-PERP", "ETH-USD-PERP", "SOL-USD-PERP"]
    deltas = BookChecker()
    snaps = SnapshotRecorder()
    inter = SnapshotRecorder()
    bbo = collections.defaultdict(list)

    def on_bbo(arrived, f, size):
        if f.get("_template") == 2:
            bbo[f["market"]].append((arrived, f["seq"], f["bidPrice"], f["askPrice"], arrived - f["ts"] / 1000))

    rest = {}

    async def rest_reads():
        await asyncio.sleep(10)
        async with httpx.AsyncClient(timeout=20) as client:
            for i in range(6):
                r = await client.get(f"{API}/orderbook/BTC-USD-PERP", params={"depth": 15})
                body = r.json()
                bids = tuple((round(float(p) * 1e8), round(float(s) * 1e8)) for p, s in body["bids"])
                asks = tuple((round(float(p) * 1e8), round(float(s) * 1e8)) for p, s in body["asks"])
                rest[("BTC-USD-PERP", body["seq_no"])] = (bids, asks)
                await asyncio.sleep(4)

    async with aiohttp.ClientSession() as session:
        d_frames = [sub(f"order_book.{m}.deltas", i) for i, m in enumerate(markets, 1)] + [sub("order_book.BTC-USD-PERP.deltas@15@50ms", 8)]
        s_frames = [sub(f"order_book.{m}.snapshot@15@50ms", i) for i, m in enumerate(markets, 1)] + [sub("order_book.XRP-USD-PERP.snapshot@15@100ms", 9)]
        i_frames = [sub("order_book.BTC-USD-PERP.interactive@15@100ms", 1), sub("order_book.XAU-USD-PERP.interactive@15@100ms", 2), sub("order_book.ETH-USD-PERP.interactive_deltas", 3), sub("order_book.ETH-USD-PERP.interactive_deltas@15@100ms", 4)]
        b_frames = [sub(f"bbo.{m}", i) for i, m in enumerate(markets[:2], 1)]
        caps = await asyncio.gather(
            run_socket(session, SBE, d_frames, 45, "deltas", on_frame=deltas.on_frame),
            run_socket(session, SBE, s_frames, 45, "snapshot@15@50ms", on_frame=snaps.on_frame),
            run_socket(session, SBE, i_frames, 45, "interactive@15@100ms", on_frame=inter.on_frame),
            run_socket(session, SBE, b_frames, 45, "bbo", on_frame=on_bbo),
            rest_reads(),
        )
    for cap in caps[:4]:
        print(cap.summary(), "opened ms", cap.opened)
        for _, text in cap.text[:6]:
            print("   text:", text[:240])
    print("-- deltas feed")
    for m in markets:
        steps = deltas.steps[m]
        print(m, "kinds", dict(deltas.kinds[m]), "first", deltas.first_kind.get(m), "seq steps", quantiles(steps), "steps of 1:", sum(1 for s in steps if s == 1), "non-positive:", sum(1 for s in steps if s <= 0))
        print("   entries per frame", quantiles(deltas.entries[m]), "max local depth", deltas.max_depth[m], "crossed local books", deltas.crossed[m])
        print("   interval ms", quantiles(intervals(deltas.arrivals[m])), "age at arrival ms", quantiles(deltas.ages[m]))
    print("zero sizes inside snapshot frames of the deltas feed:", deltas.zero_in_snapshot)
    print("-- snapshot feed")
    for m in markets + ["XRP-USD-PERP"]:
        print(m, "kinds", dict(snaps.kinds[m]), "repeats of the same seq", snaps.repeats[m], "levels", collections.Counter(snaps.levels[m]).most_common(3), "ordered frames", snaps.order_ok[m], "api fields set", snaps.api_fields[m], "interactive fields set", snaps.interactive_fields[m])
        print("   interval ms", quantiles(intervals(snaps.arrivals[m])), "age at arrival ms", quantiles(snaps.ages[m]))
    for sample in snaps.samples:
        print("   snapshot frame with interactive fields set:", sample)
    matched = mismatched = 0
    examples = []
    for key, (bids, asks) in snaps.at_seq.items():
        if key in deltas.at_seq:
            d_bids, d_asks = deltas.at_seq[key]
            if (d_bids, d_asks) == (bids[:15], asks[:15]):
                matched += 1
            else:
                mismatched += 1
                if len(examples) < 2:
                    examples.append({"key": key, "snapshot_top3": (bids[:3], asks[:3]), "deltas_top3": (d_bids[:3], d_asks[:3]), "len": (len(bids), len(asks), len(d_bids), len(d_asks))})
    print(f"snapshot frames whose seq the deltas book also reached: {matched + mismatched}, equal top 15 {matched}, different {mismatched}")
    for e in examples:
        print("   example difference:", e)
    rest_match = rest_diff = rest_seen = 0
    for key, (bids, asks) in rest.items():
        if key in deltas.at_seq:
            rest_seen += 1
            if deltas.at_seq[key] == (bids, asks):
                rest_match += 1
            else:
                rest_diff += 1
    print(f"REST reads {len(rest)}, seq numbers {sorted(k[1] for k in rest)}, of which the deltas book reached {rest_seen}: equal {rest_match}, different {rest_diff}")
    print("-- interactive feed")
    for sample in inter.samples:
        print("   interactive frame with interactive fields set:", sample)
    for m in ("BTC-USD-PERP", "XAU-USD-PERP", "ETH-USD-PERP"):
        print(m, "kinds", dict(inter.kinds[m]), "levels", collections.Counter(inter.levels[m]).most_common(3), "api fields set", inter.api_fields[m], "interactive fields set", inter.interactive_fields[m], "interval ms", quantiles(intervals(inter.arrivals[m])))
    last_inter = [f for _, f in caps[2].binary if f.get("_template") == 3 and f["market"] == "BTC-USD-PERP"][-1:]
    for f in last_inter:
        print("   last BTC interactive frame:", {k: v for k, v in f.items() if k not in ("bids", "asks")}, "top bid", f["bids"][:1], "top ask", f["asks"][:1])
    last_snap = [f for _, f in caps[1].binary if f.get("_template") == 3 and f["market"] == "BTC-USD-PERP"][-1:]
    for f in last_snap:
        print("   last BTC snapshot frame:", {k: v for k, v in f.items() if k not in ("bids", "asks")}, "top bid", f["bids"][:1], "top ask", f["asks"][:1])
    print("-- bbo")
    for m, rows in bbo.items():
        seqs = [r[1] for r in rows]
        print(m, "frames", len(rows), "interval ms", quantiles(intervals([r[0] for r in rows])), "age ms", quantiles([r[4] for r in rows]), "seq non-increasing", sum(1 for i in range(len(seqs) - 1) if seqs[i + 1] <= seqs[i]))
    save("ws-raw-frames-book.json", {cap.label: cap.raw for cap in caps[:4]})
    save("ws-book-frames-sample.json", {"deltas": [f for _, f in caps[0].binary[:6]], "snapshot": [f for _, f in caps[1].binary[:3]], "interactive": [f for _, f in caps[2].binary[:2]], "bbo": [f for _, f in caps[3].binary[:3]], "text": [t for _, t in caps[0].text[:4]]})


async def mode_batch() -> None:
    print(f"== batch {utc()}")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(f"{API}/markets")
        perps = sorted(m["symbol"] for m in r.json()["results"] if m.get("asset_kind") == "PERP")
    stats = {}
    for label in ("deltas", "snapshot"):
        stats[label] = {"frames": 0, "bytes": 0, "decode_us": [], "markets": collections.Counter(), "steps_bad": 0, "last": {}, "kinds": collections.Counter()}

    def make(label):
        s = stats[label]

        def on_frame(arrived, f, size):
            s["frames"] += 1
            s["bytes"] += size
            if f.get("_template") == 3:
                s["markets"][f["market"]] += 1
                s["kinds"][f["pkgType"]] += 1
                last = s["last"].get(f["market"])
                if last is not None and label == "deltas" and f["seq"] != last + 1:
                    s["steps_bad"] += 1
                if last is not None and label == "snapshot" and f["seq"] <= last:
                    s["steps_bad"] += 1
                s["last"][f["market"]] = f["seq"]
        return on_frame

    async with aiohttp.ClientSession() as session:
        caps = await asyncio.gather(
            run_socket(session, SBE, [sub(f"order_book.{m}.deltas", i) for i, m in enumerate(perps, 1)], 45, "deltas on every perp", on_frame=make("deltas")),
            run_socket(session, SBE, [sub(f"order_book.{m}.snapshot@15@50ms", i) for i, m in enumerate(perps, 1)], 45, "snapshot on every perp", on_frame=make("snapshot")),
        )
    for cap, label in zip(caps, ("deltas", "snapshot")):
        s = stats[label]
        acks = [t for _, t in cap.text if '"result"' in t]
        errors = [t for _, t in cap.text if '"error"' in t]
        frames = [f for _, f in cap.binary]
        t_decode = time.perf_counter()
        raw = [(f["_bytes"]) for f in frames]
        print(cap.summary(), "opened ms", cap.opened, "acks", len(acks), "errors", errors[:3])
        print(f"   {label}: {s['frames']} frames in 45 s, {s['frames'] / 45:.1f} a second, {s['bytes'] / 45 / 1024:.1f} KiB a second, {s['bytes'] / max(1, s['frames']):.0f} bytes a frame, markets seen {len(s['markets'])} of {len(perps)}, pkgType counts {dict(s['kinds'])}, seq breaks (deltas: step not 1, snapshot: not increasing) {s['steps_bad']}")
        print("   frames per market:", quantiles(list(s["markets"].values())), "quietest:", s["markets"].most_common()[-5:])
    # Decode cost, measured offline on the captured deltas frames re-encoded size only.
    sample = [f for _, f in caps[0].binary[:2000]]
    print("decoded frame sizes, deltas:", quantiles([f["_bytes"] for f in sample]))


async def mode_anchor() -> None:
    print(f"== anchor {utc()}")
    markets = ["BTC-USD-PERP", "ETH-USD-PERP", "kPEPE-USD-PERP", "XAU-USD-PERP", "NVDA-USD-PERP"]
    summary = collections.defaultdict(list)
    funding = collections.defaultdict(list)
    all_summary = collections.Counter()

    def on_summary(arrived, f, size):
        if f.get("_template") == 4:
            summary[f["market"]].append((arrived, f))
        elif f.get("_template") == 5:
            funding[f["market"]].append((arrived, f))

    def on_all(arrived, f, size):
        if f.get("_template") == 4:
            all_summary["perp" if f["market"].endswith("-PERP") else "other"] += 1
            all_summary["frames"] += 1

    async with aiohttp.ClientSession() as session:
        frames = [sub(f"markets_summary.{m}", i) for i, m in enumerate(markets, 1)] + [sub(f"funding_data.{m}", 10 + i) for i, m in enumerate(markets, 1)]
        caps = await asyncio.gather(
            run_socket(session, SBE, frames, 50, "markets_summary and funding_data per market", on_frame=on_summary),
            run_socket(session, SBE, [sub("markets_summary", 1)], 15, "markets_summary with no market", on_frame=on_all),
            run_socket(session, SBE, [sub("funding_data.ALL", 1), sub("markets_summary.ALL", 2)], 8, "ALL suffixes"),
        )
    for cap in caps:
        print(cap.summary(), "opened ms", cap.opened)
        for _, text in cap.text[:4]:
            print("   text:", text[:240])
    print("markets_summary with no market, 15 s:", dict(all_summary))
    for m in markets:
        rows = summary[m]
        arrivals = [a for a, _ in rows]
        marks = [f["markPrice"] for _, f in rows]
        index = [f["indexPrice"] for _, f in rows]
        ts_steps = [rows[i + 1][1]["ts"] - rows[i][1]["ts"] for i in range(len(rows) - 1)]
        changes_mark = sum(1 for i in range(len(marks) - 1) if marks[i + 1] != marks[i])
        changes_index = sum(1 for i in range(len(index) - 1) if index[i + 1] != index[i])
        ages = [a - f["ts"] / 1000 for a, f in rows]
        print(m, "summary frames", len(rows), "interval ms", quantiles(intervals(arrivals)), "ts step us", quantiles(ts_steps), "age at arrival ms", quantiles(ages), "mark changes", changes_mark, "index changes", changes_index, "of", max(0, len(rows) - 1))
        if rows:
            f = rows[-1][1]
            print("   last summary:", {k: f.get(k) for k in ("_block", "_version", "ts", "seq", "markPrice", "indexPrice", "lastPrice", "fundingRate", "fundingRatePrecise", "bid", "ask", "externalFairPrice", "openInterest")})
        frows = funding[m]
        f_arrivals = [a for a, _ in frows]
        print("   funding frames", len(frows), "interval ms", quantiles(intervals(f_arrivals)), "age at arrival ms", quantiles([a - f["ts"] / 1000 for a, f in frows]))
        if frows:
            f = frows[-1][1]
            print("   last funding:", {k: f.get(k) for k in ("_block", "_version", "ts", "createdAt", "seq", "fundingRate", "fundingRate8h", "fundingPeriodHours", "fundingPremium", "fundingIndex", "impactPremiumRate")})
    save("ws-raw-frames-anchor.json", {caps[0].label: caps[0].raw})
    save("ws-anchor-sample.json", {m: [f for _, f in summary[m][:3]] for m in markets})


async def mode_errors() -> None:
    print(f"== errors {utc()}")
    frames = [
        sub("order_book.NOPE-USD-PERP.snapshot@15@50ms", 1),
        sub("order_book.BTC-USD-PERP.snapshot@20@50ms", 2),
        sub("order_book.BTC-USD-PERP.snapshot@15@10ms", 3),
        sub("order_book.btc-usd-perp.snapshot@15@50ms", 4),
        sub("bbo.BTC-USD-PERP", 5),
        sub("bbo.BTC-USD-PERP", 6),
        sub("nope", 7),
        '{"jsonrpc":"2.0","method":',
        json.dumps({"jsonrpc": "2.0", "method": "foo", "id": 9}),
        json.dumps({"jsonrpc": "2.0", "method": "subscribe", "params": {"channel": "trades.BTC-USD-PERP"}}),
        json.dumps({"jsonrpc": "2.0", "method": "unsubscribe", "params": {"channel": "bbo.ETH-USD-PERP"}, "id": 11}),
        sub("order_book.ETH-USD-PERP.deltas@15@100ms", 12),
    ]
    async with aiohttp.ClientSession() as session:
        cap = await run_socket(session, SBE, frames, 12, "errors", gap=0.3)
    print(cap.summary(), "opened ms", cap.opened)
    for arrived, text in cap.text:
        print("   text:", text[:300])
    markets = collections.Counter(f.get("market") for _, f in cap.binary)
    print("binary frames by market after the bad frames:", dict(markets))
    bbo_seqs = [f["seq"] for _, f in cap.binary if f.get("_template") == 2]
    print("bbo frames", len(bbo_seqs), "distinct seq", len(set(bbo_seqs)), "frames repeating the previous seq", sum(1 for i in range(1, len(bbo_seqs)) if bbo_seqs[i] == bbo_seqs[i - 1]))


async def client_ping(session) -> str:
    ws = await session.ws_connect(SBE, autoping=False, compress=0, heartbeat=None)
    t0 = time.perf_counter()
    await ws.ping(b"probe")
    try:
        while True:
            msg = await asyncio.wait_for(ws.receive(), timeout=5)
            if msg.type == aiohttp.WSMsgType.PONG:
                return f"pong {msg.data!r} after {(time.perf_counter() - t0) * 1000:.1f} ms"
    except asyncio.TimeoutError:
        return "no pong within 5 s"
    finally:
        await ws.close()


async def mode_silence() -> None:
    print(f"== silence {utc()}")
    async with aiohttp.ClientSession() as session:
        print("client protocol ping:", await client_ping(session))
        caps = await asyncio.gather(
            run_socket(session, SBE, [], 75, "idle, no pong", autoping=False, answer_pings=False),
            run_socket(session, SBE, [], 75, "idle, answers pings", autoping=False, answer_pings=True),
        )
    for cap in caps:
        heartbeats = [round((a - cap.opened_at) / 1000, 2) for a, f in cap.binary if f.get("_template") == 40]
        print(cap.summary(), "opened ms", cap.opened, "server pings at s", cap.pings, "heartbeat frames at s", heartbeats)
        for a, f in cap.binary[:3]:
            print("   binary:", f)
        for _, text in cap.text[:3]:
            print("   text:", text[:200])


MODES = {"encoding": mode_encoding, "book": mode_book, "batch": mode_batch, "anchor": mode_anchor, "errors": mode_errors, "silence": mode_silence}

if __name__ == "__main__":
    for name in sys.argv[1:] or list(MODES):
        asyncio.run(MODES[name]())
