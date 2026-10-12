# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of the ZKE futures socket, the ChainUp kline-api socket.

Modes: hosts (about 10 s), basic (30 s), all (45 s), marks (25 s on three sockets), silence (60 s), pong (35 s), and all of them in turn by default, about four minutes of socket time.
Run from the repository root: uv run scripts/probes/venues/zke/ws-probe.py [mode]
Captures go to .claude/survey-work/zke/.
"""

import asyncio
import collections
import gzip
import json
import statistics
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/zke")
URL = "wss://futuresws.zke.com/kline-api/ws"  # the wsUrl of the futures web list
HOSTS = [URL, "wss://ws.zke.com/kline-api/ws"]  # the second is the spot socket of the site config and the API document
FAPI = "https://futuresopenapi.zke.com/fapi/v1"
WEB_INFO = "https://futures.zke.com/fe-co-api/common/public_info"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
BTC = "e_btcusdt"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def sub(channel: str, cb: str = "") -> str:
    return json.dumps({"event": "sub", "params": {"channel": channel, "cb_id": cb}})


def decode(message) -> tuple[str, dict | None, int, str]:
    if isinstance(message, str):
        gz, text = "text", message
    elif message[:2] == b"\x1f\x8b":
        gz, text = "binary gzip", gzip.decompress(message).decode()
    else:
        gz, text = "binary plain", message.decode()
    try:
        return text, json.loads(text), len(message), gz
    except ValueError:
        return text, None, len(message), gz


def rest_book(symbol: str) -> dict:
    req = urllib.request.Request(f"{FAPI}/depth?contractName={symbol}&limit=100", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as reply:
        return json.loads(reply.read())


def web_list() -> list[dict]:
    req = urllib.request.Request(WEB_INFO, data=b"{}", headers={"User-Agent": UA, "Content-Type": "application/json", "exchange-language": "en_US"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as reply:
        return json.loads(reply.read())["data"]["contractList"]


async def connect(url: str = URL):
    start = time.perf_counter()
    ws = await websockets.connect(url, compression=None, max_size=None, open_timeout=20, ping_interval=None, user_agent_header=UA)
    print(f"{now()} {url} open in {(time.perf_counter() - start) * 1000:.0f} ms, status {ws.response.status_code}, extensions header {ws.response.headers.get('Sec-WebSocket-Extensions')}")
    return ws


def is_ordered(levels: list, descending: bool) -> bool:
    return all((float(levels[i][0]) > float(levels[i + 1][0])) if descending else (float(levels[i][0]) < float(levels[i + 1][0])) for i in range(len(levels) - 1))


async def mode_hosts() -> None:
    print(f"\n# hosts, {now()}")
    for url in HOSTS:
        try:
            ws = await connect(url)
        except Exception as error:  # a refusal is a result here
            print(f"{url}: {type(error).__name__} {error}")
            continue
        await ws.send(sub(f"market_{BTC}_depth_step0", "x"))
        await ws.send(sub("market_btcusdt_depth_step0", "spot"))
        seen = collections.Counter()
        end = time.time() + 3
        while time.time() < end:
            try:
                _, data, _, _ = decode(await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time())))
            except asyncio.TimeoutError:
                break
            seen[(data or {}).get("channel") or (data or {}).get("event_rep") or str(data)[:60]] += 1
        await ws.close()
        print(f"{url}: frames in 3 s {dict(seen)}")


async def mode_basic() -> None:
    print(f"\n# basic, {now()}")
    ws = await connect()
    # usdt1858_btcusdt is CZR's spelling on the same ChainUp deployment, e_btcusd ZKE's coin margined BTC contract.
    channels = [f"market_{BTC}_depth_step0", f"market_{BTC}_ticker", f"mark_price_{BTC}", f"market_{BTC}_trade_ticker",
                f"market_{BTC}_depth_step1", "market_e_nopeusdt_depth_step0", f"market_{BTC}", "mark_price_e_nopeusdt",
                "market_usdt1858_btcusdt_depth_step0", "market_E-ETH-USDT_depth_step0", "market_e_solusdt_depth_step0", "market_e_btcusd_depth_step0", "mark_price_e_btcusd"]
    for channel in channels:
        await ws.send(sub(channel, channel))
    await ws.send("not json")
    await ws.send(json.dumps({"event": "nope", "params": {"channel": f"market_{BTC}_depth_step0"}}))
    counts = collections.Counter()
    first = {}
    depth_times, depth_sizes, prev, same_frames, kinds = [], [], None, 0, collections.Counter()
    levels = collections.Counter()
    orders_ok = True
    stamps = []
    rest_check = None
    tick = None
    end = time.time() + 30
    while time.time() < end:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        text, data, size, gz = decode(message)
        kinds[gz] += 1
        key = (data or {}).get("channel") or (data or {}).get("event_rep") or (list(data)[0] if data else text[:40])
        counts[key] += 1
        if key not in first:
            first[key] = text[:600]
        if key == f"market_{BTC}_depth_step0":
            tick = data["tick"]
            depth_times.append(time.time())
            depth_sizes.append(size)
            bids = tick.get("buys") or tick.get("bids") or []
            asks = tick.get("asks") or []
            levels[(len(bids), len(asks))] += 1
            orders_ok &= is_ordered(bids, True) and is_ordered(asks, False)
            stamps.append(data.get("ts"))
            if prev is not None and prev == (bids, asks):
                same_frames += 1
            prev = (bids, asks)
            if rest_check is None and len(depth_times) == 5:
                rest = await asyncio.to_thread(rest_book, "E-BTC-USDT")
                rest_check = (bids[:3], asks[:3], rest["bids"][:3], rest["asks"][:3])
    await ws.close()
    print("frames by channel:", dict(counts))
    print("frame kinds:", dict(kinds))
    for key, text in first.items():
        print(f"first {key}: {text}")
    gaps = [b - a for a, b in zip(depth_times, depth_times[1:])]
    if gaps:
        print(f"BTC depth frames: {len(depth_times)}, gap median {statistics.median(gaps) * 1000:.0f} ms, max {max(gaps) * 1000:.0f} ms, wire bytes median {statistics.median(depth_sizes):.0f}")
    print("levels per frame (bids, asks):", dict(levels), "ordered:", orders_ok, "frames equal to the one before:", same_frames)
    print("ts values distinct:", len(set(stamps)), "of", len(stamps), "keys of the last tick:", list(tick) if tick else None)
    print("socket top 3 against REST top 3 read during the run:", rest_check)


async def mode_all() -> None:
    print(f"\n# all, {now()}")
    listed = [row for row in web_list() if row["contractType"] == "E" and row["contractSide"] == 1]
    subs = [row["subSymbol"] for row in listed]
    ws = await connect()
    for raw in subs:
        await ws.send(sub(f"market_{raw}_depth_step0", raw))
        await ws.send(sub(f"mark_price_{raw}", raw))
    print(f"{now()} sent {2 * len(subs)} subscriptions for {len(subs)} contracts")
    books, marks, counts = collections.Counter(), {}, collections.Counter()
    first_book_at = {}
    depth_levels = collections.Counter()
    started = time.time()
    other = collections.Counter()
    end = started + 45
    closed = None
    while time.time() < end:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as error:
            closed = f"{error.code} {error.reason}"
            break
        _, data, _, _ = decode(message)
        channel = (data or {}).get("channel", "")
        if channel.endswith("_depth_step0"):
            raw = channel[len("market_"):-len("_depth_step0")]
            books[raw] += 1
            first_book_at.setdefault(raw, time.time() - started)
            t = data.get("tick") or {}
            depth_levels[min(len(t.get("buys") or []), len(t.get("asks") or []))] += 1
        elif channel.startswith("mark_price_"):
            raw = channel[len("mark_price_"):]
            marks[raw] = data["tick"]
            counts[raw] += 1
        else:
            other[json.dumps(data)[:120]] += 1
    if closed is None:
        await ws.close()
    (WORK / "socket-marks.json").write_text(json.dumps(marks))
    print(f"closed early: {closed}")
    if books:
        print(f"contracts with a book frame: {len(books)} of {len(subs)}, last first book at {max(first_book_at.values()):.1f} s")
        print(f"book frames per contract in 45 s: min {min(books.values())}, median {statistics.median(books.values())}, max {max(books.values())}, total {sum(books.values())}")
        print("smaller side levels per depth frame, top counts:", depth_levels.most_common(6))
    print("no book frame:", sorted(set(subs) - set(books))[:20])
    print(f"contracts with a mark frame: {len(marks)} of {len(subs)}, frames per contract median {statistics.median(counts.values()) if counts else 0}, max {max(counts.values()) if counts else 0}")
    print("mark tick keys:", collections.Counter(tuple(sorted(tick)) for tick in marks.values()).most_common(2))
    if BTC in marks:
        print("BTC mark tick:", json.dumps(marks[BTC]))
    by_raw = {row["subSymbol"]: row for row in listed}
    agree = sum(str(by_raw[raw]["nextCapitalSettTime"]) == str(tick.get("nextSettlementTime")) for raw, tick in marks.items() if raw in by_raw)
    print(f"nextSettlementTime equals the web list's nextCapitalSettTime on {agree} of {len(marks)}")
    same = sum(float(tick.get("currentFundRate") or "nan") == float(tick.get("nextFundRate") or "nan") for tick in marks.values())  # strings with different padding
    print(f"currentFundRate equals nextFundRate on {same} of {len(marks)}")
    print("other frames:", other.most_common(5))


# The all mode saw about two mark frames per contract in 60 s, so this compares sockets with and without depth channels.
async def count_marks(label: str, raws: list[str], with_depth: bool, seconds: float) -> None:
    ws = await connect()
    for raw in raws:
        if with_depth:
            await ws.send(sub(f"market_{raw}_depth_step0", raw))
        await ws.send(sub(f"mark_price_{raw}", raw))
    stamps = collections.defaultdict(list)
    depth = 0
    end = time.time() + seconds
    while time.time() < end:
        try:
            _, data, _, _ = decode(await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time())))
        except asyncio.TimeoutError:
            break
        channel = (data or {}).get("channel", "")
        if channel.startswith("mark_price_"):
            stamps[channel[len("mark_price_"):]].append(time.time())
        elif channel.endswith("_depth_step0"):
            depth += 1
    await ws.close()
    counts = [len(stamps.get(raw, [])) for raw in raws]
    gaps = [b - a for raw in raws for a, b in zip(stamps.get(raw, []), stamps.get(raw, [])[1:])]
    gap_text = f"{statistics.median(gaps):.2f} s" if gaps else "none"
    print(f"{label}: {len(raws)} contracts, depth too {with_depth}, {seconds:.0f} s: mark frames per contract min {min(counts)}, median {statistics.median(counts)}, max {max(counts)}, "
          f"contracts with none {counts.count(0)}, median gap {gap_text}, depth frames {depth}, BTC marks {len(stamps.get(BTC, []))}")


async def mode_marks() -> None:
    print(f"\n# marks, {now()}")
    subs = [row["subSymbol"] for row in web_list() if row["contractType"] == "E" and row["contractSide"] == 1]
    await asyncio.gather(count_marks("BTC mark only", [BTC], False, 25), count_marks("BTC depth and mark", [BTC], True, 25),
                         count_marks("every mark, no depth", subs, False, 25))


async def mode_silence() -> None:
    print(f"\n# silence, {now()}")
    ws = await connect()
    await ws.send(sub(f"market_{BTC}_depth_step0"))
    started = time.time()
    pings, frames, closed = [], 0, None
    while time.time() - started < 60:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=5)
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as error:
            closed = f"{error.code} {error.reason!r} after {time.time() - started:.1f} s"
            break
        text, data, _, _ = decode(message)
        frames += 1
        if data and "ping" in data:
            pings.append((round(time.time() - started, 1), text))
    if closed is None:
        await ws.close()
    print(f"sent nothing after the subscription for 60 s: {frames} frames, server pings {pings[:10]}, closed {closed}")


async def mode_pong() -> None:
    print(f"\n# pong, {now()}")
    ws = await connect()
    await ws.send(sub(f"market_{BTC}_depth_step0"))
    started = time.time()
    replies, sent, answered, closed = [], 0, 0, None
    while time.time() - started < 35:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as error:
            closed = f"{error.code} {error.reason!r}"
            break
        text, data, _, _ = decode(message)
        if data and "ping" in data:
            await ws.send(json.dumps({"pong": data["ping"]}))
            answered += 1
            replies.append((round(time.time() - started, 1), text))
        elif data and "pong" in data:
            replies.append((round(time.time() - started, 1), text))
    await ws.send(json.dumps({"ping": int(time.time() * 1000)}))
    sent += 1
    try:
        for _ in range(20):
            text, data, _, _ = decode(await asyncio.wait_for(ws.recv(), timeout=3))
            if data and ("ping" in data or "pong" in data):
                replies.append(("after client ping", text))
                break
    except (asyncio.TimeoutError, websockets.ConnectionClosed):
        pass
    if closed is None:
        await ws.close()
    print(f"answered {answered} server pings with pong, sent {sent} client ping, keepalive frames: {replies}, closed {closed}")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else "all-modes"
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"), "mode", mode)
    modes = {"hosts": mode_hosts, "basic": mode_basic, "all": mode_all, "marks": mode_marks, "silence": mode_silence, "pong": mode_pong}
    for name, run in modes.items():
        if mode in (name, "all-modes"):
            asyncio.run(run())


if __name__ == "__main__":
    main()
