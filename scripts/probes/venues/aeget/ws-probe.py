# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for AEGET's futures market socket, the one its web app opens.

Modes, each runnable alone: book, batch, market, errors, all (the default).
Run from the repository root: uv run scripts/probes/venues/aeget/ws-probe.py [mode]
Sockets are held for about three minutes in total by "all".
Captures go to .claude/survey-work/aeget/.
"""

import asyncio
import collections
import json
import statistics
import sys
import time
import zlib
from datetime import datetime, timezone
from pathlib import Path

import websockets

URL = "wss://aeget.io/ws/market"
WORK = Path(".claude/survey-work/aeget")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) survey-probe", "Origin": "https://aeget.io"}
SAMPLES: dict[str, str] = {}


def decode(raw) -> tuple[str, object]:
    """Returns the frame kind and its parsed body: text, json, or binary inflated with zlib as the web app's pako does."""
    if isinstance(raw, bytes):
        try:
            text = zlib.decompress(raw).decode()
        except zlib.error:
            text = zlib.decompress(raw, -zlib.MAX_WBITS).decode()
        return "binary", json.loads(text)
    try:
        return "json", json.loads(raw)
    except ValueError:
        return "text", raw


def keep(name: str, raw) -> None:
    if name not in SAMPLES:
        SAMPLES[name] = raw if isinstance(raw, str) else f"binary {len(raw)} bytes: {decode(raw)[1]}"


async def connect():
    start = time.perf_counter()
    socket = await websockets.connect(URL, additional_headers=HEADERS, compression=None, open_timeout=30, max_size=2**24)
    return socket, (time.perf_counter() - start) * 1000


async def watch_symbol(symbol: str, seconds: float, ping: bool) -> dict:
    socket, open_ms = await connect()
    await socket.send(json.dumps({"req": "sub_symbol", "symbol": symbol}))
    stats = {"symbol": symbol, "open_ms": round(open_ms), "kinds": collections.Counter(), "channels": collections.Counter()}
    full_times, full_levels, delta_ids, pong_ms = [], [], [], []
    bids_desc = asks_asc = 0
    sci = 0
    first_channel = None
    book = None
    matches = compared = 0
    ping_sent = None
    last_ping = time.monotonic()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if ping and time.monotonic() - last_ping > 10:
            ping_sent = time.perf_counter()
            await socket.send("ping")
            last_ping = time.monotonic()
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        kind, body = decode(raw)
        stats["kinds"][kind] += 1
        if kind == "text":
            stats["channels"][f"text {body}"] += 1
            keep(f"text {body}", raw)
            if body == "pong" and ping_sent:
                pong_ms.append((time.perf_counter() - ping_sent) * 1000)
            continue
        channel = body.get("channel") or body.get("type") or body.get("resType")
        stats["channels"][channel] += 1
        keep(channel, raw)
        first_channel = first_channel or channel
        data = body.get("data") or {}
        text = json.dumps(data)
        sci += text.count("E+")
        if channel == "push.deep.full":
            full_times.append(time.monotonic())
            bids, asks = data.get("b", []), data.get("a", [])
            full_levels.append((len(bids), len(asks)))
            bids_desc += all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))
            asks_asc += all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))
            if book is not None and bids:
                compared += 1
                top_built = sorted(((p, q) for p, q in book["b"].items() if q > 0), reverse=True)[:5]
                top_full = [(float(p), float(q)) for p, q in bids[:5]]
                matches += top_built == top_full
            book = {"b": {float(p): float(q) for p, q in bids}, "a": {float(p): float(q) for p, q in asks}}
        elif channel == "push.deep":
            delta_ids.append(int(data["id"]))
            if book is not None:
                side = "b" if data.get("ba") == 1 else "a"
                book[side][float(data["p"])] = float(data["q"])
    await socket.close()
    gaps = [b - a for a, b in zip(full_times, full_times[1:])]
    stats.update(
        full_frames=len(full_times),
        full_levels=collections.Counter(full_levels).most_common(3),
        full_gap_ms=(round(min(gaps) * 1000), round(statistics.median(gaps) * 1000), round(max(gaps) * 1000)) if gaps else None,
        bids_descending=bids_desc,
        asks_ascending=asks_asc,
        deltas=len(delta_ids),
        delta_id_reversals=sum(1 for a, b in zip(delta_ids, delta_ids[1:]) if b < a),
        delta_id_steps=collections.Counter(b - a for a, b in zip(delta_ids, delta_ids[1:])).most_common(3),
        scientific_sizes=sci,
        first_channel=first_channel,
        rebuilt_top5_bids_match=f"{matches} of {compared}",
        pong_ms=[round(x) for x in pong_ms],
        kinds=dict(stats["kinds"]),
        channels=dict(stats["channels"]),
    )
    return stats


async def book_mode() -> None:
    print("## book: btc_usdt and eth_usdt on two sockets for 40 s, ping every 10 s")
    for result in await asyncio.gather(watch_symbol("btc_usdt", 40, True), watch_symbol("eth_usdt", 40, True)):
        print(json.dumps(result, default=str))


async def batch_mode() -> None:
    print("## batch: sub_symbol for 5 symbols on one socket for 20 s")
    socket, open_ms = await connect()
    symbols = ["btc_usdt", "eth_usdt", "sol_usdt", "xrp_usdt", "doge_usdt"]
    for symbol in symbols:
        await socket.send(json.dumps({"req": "sub_symbol", "symbol": symbol}))
    seen = collections.Counter()
    acks = 0
    end = time.monotonic() + 20
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        kind, body = decode(raw)
        if kind == "text":
            acks += body == "succeed"
            continue
        data = body.get("data") or {}
        seen[(body.get("channel"), data.get("s") if isinstance(data, dict) else None)] += 1
    await socket.close()
    print(f"open {open_ms:.0f} ms, succeed replies {acks}")
    for key, count in sorted(seen.items(), key=str):
        print(f"  {key}: {count}")


async def market_mode() -> None:
    print("## market: sub_tickers and sub_mark_prices for 15 s")
    socket, open_ms = await connect()
    await socket.send(json.dumps({"req": "sub_tickers"}))
    await socket.send(json.dumps({"req": "sub_mark_prices"}))
    frames = collections.defaultdict(list)
    end = time.monotonic() + 15
    while time.monotonic() < end:
        try:
            raw = await asyncio.wait_for(socket.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        kind, body = decode(raw)
        if kind == "text":
            frames[f"text {body}"].append(0)
            continue
        channel = body.get("channel")
        keep(channel, raw if len(str(raw)) < 600 else str(raw)[:600])
        data = body.get("data")
        frames[channel].append(len(data) if isinstance(data, list) else 1)
    await socket.close()
    print(f"open {open_ms:.0f} ms")
    for channel, sizes in frames.items():
        print(f"  {channel}: {len(sizes)} frames, rows per frame {collections.Counter(sizes).most_common(3)}")


async def errors_mode() -> None:
    print("## errors")
    socket, open_ms = await connect()
    print(f"open {open_ms:.0f} ms, extensions {socket.response.headers.get('Sec-WebSocket-Extensions')}")
    for frame in [json.dumps({"req": "sub_symbol", "symbol": "nope_usdt"}), json.dumps({"req": "sub_nothing"}), json.dumps({"ping": 1}), "ping", "not json"]:
        await socket.send(frame)
        replies = []
        end = time.monotonic() + 4
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(socket.recv(), timeout=1)
                replies.append(decode(raw)[1])
            except asyncio.TimeoutError:
                continue
            except websockets.ConnectionClosed as closed:
                replies.append(f"closed {closed.rcvd.code if closed.rcvd else None} {closed.rcvd.reason if closed.rcvd else ''}")
                break
        print(f"  sent {frame}: {[str(r)[:160] for r in replies]}")
        if replies and str(replies[-1]).startswith("closed"):
            break
    try:
        await socket.close()
    except Exception:
        pass
    print("## silence: one subscribed socket that never pings, held 70 s")
    socket, _ = await connect()
    await socket.send(json.dumps({"req": "sub_symbol", "symbol": "btc_usdt"}))
    start = time.monotonic()
    outcome = "open at 70 s"
    while time.monotonic() - start < 70:
        try:
            await asyncio.wait_for(socket.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as closed:
            outcome = f"closed at {time.monotonic() - start:.1f} s, code {closed.rcvd.code if closed.rcvd else None}"
            break
    print(f"  {outcome}")
    await socket.close()


async def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"aeget ws probe, {datetime.now(timezone.utc).isoformat(timespec='seconds')}, mode {mode}, {URL}")
    if mode in ("book", "all"):
        await book_mode()
    if mode in ("batch", "all"):
        await batch_mode()
    if mode in ("market", "all"):
        await market_mode()
    if mode in ("errors", "all"):
        await errors_mode()
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / f"ws-samples-{mode}.json").write_text(json.dumps(SAMPLES, indent=1, default=str))
    print("## samples")
    for name, raw in SAMPLES.items():
        print(f"  {name}: {str(raw)[:420]}")


if __name__ == "__main__":
    asyncio.run(main())
