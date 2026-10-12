# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of the idax futures socket, the ChainUp kline-api socket.

Modes: basic (35 s), all (60 s), silence (90 s), pong (50 s), and all of them in turn by default, about four minutes of socket time.
Run from the repository root: uv run scripts/probes/venues/idax/ws-probe.py [mode]
Captures go to .claude/survey-work/idax/.
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

WORK = Path(".claude/survey-work/idax")
URL = "wss://futuresws.idax.exchange/kline-api/ws"
FAPI = "https://futuresopenapi.idax.exchange/fapi/v1"
WEB_INFO = "https://futures.idax.exchange/fe-co-api/common/public_info"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def sub(channel: str, cb: str = "") -> str:
    return json.dumps({"event": "sub", "params": {"channel": channel, "cb_id": cb}})


def decode(message) -> tuple[str, dict | None, int, str]:
    # Most frames are gzip in a binary frame, and a few are plain JSON in a binary frame.
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


async def connect():
    start = time.perf_counter()
    ws = await websockets.connect(URL, compression=None, max_size=None, open_timeout=20, ping_interval=None, user_agent_header=UA)
    print(f"{now()} open in {(time.perf_counter() - start) * 1000:.0f} ms, extensions header {ws.response.headers.get('Sec-WebSocket-Extensions')}")
    return ws


def is_ordered(levels: list, descending: bool) -> bool:
    return all((levels[i][0] > levels[i + 1][0]) if descending else (levels[i][0] < levels[i + 1][0]) for i in range(len(levels) - 1))


async def mode_basic() -> None:
    print(f"\n# basic, {now()}")
    ws = await connect()
    channels = ["market_e_btcusdt_depth_step0", "market_e_btcusdt_ticker", "mark_price_e_btcusdt", "market_e_btcusdt_trade_ticker",
                "market_e_btcusdt_depth_step1", "market_e_nopeusdt_depth_step0", "market_e_btcusdt", "mark_price_e_nopeusdt",
                "market_E-ETH-USDT_depth_step0", "market_e_solusdt_depth_step0"]  # SOL gets depth only, to see whether its mark rides along
    for channel in channels:
        await ws.send(sub(channel, channel))
    await ws.send("not json")
    await ws.send(json.dumps({"event": "nope", "params": {"channel": "market_e_btcusdt_depth_step0"}}))
    counts = collections.Counter()
    first = {}
    depth_times, depth_sizes, prev, same_frames, binary = [], [], None, 0, collections.Counter()
    levels = collections.Counter()
    orders_ok = True
    frames_with_ts = []
    rest_check = None
    end = time.time() + 35
    while time.time() < end:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        text, data, size, gz = decode(message)
        binary[gz] += 1
        key = (data or {}).get("channel") or ((data or {}).get("event_rep") or None) or (list(data)[0] if data else text[:40])
        counts[key] += 1
        if key not in first:
            first[key] = text[:500]
        if key == "market_e_btcusdt_depth_step0":
            tick = data["tick"]
            depth_times.append(time.time())
            depth_sizes.append(size)
            levels[(len(tick.get("buys") or tick.get("bids") or []), len(tick.get("asks") or []))] += 1
            bids = tick.get("buys") or tick.get("bids") or []
            asks = tick.get("asks") or []
            orders_ok &= is_ordered(bids, True) and is_ordered(asks, False)
            frames_with_ts.append(data.get("ts"))
            if prev is not None and prev == (bids, asks):
                same_frames += 1
            prev = (bids, asks)
            if rest_check is None and len(depth_times) == 5:
                rest = await asyncio.to_thread(rest_book, "E-BTC-USDT")
                rest_check = (bids[:3], asks[:3], rest["bids"][:3], rest["asks"][:3])
    await ws.close()
    print("frames by channel:", dict(counts))
    print("frame kinds:", dict(binary))
    for key, text in first.items():
        print(f"first {key}: {text}")
    gaps = [b - a for a, b in zip(depth_times, depth_times[1:])]
    if gaps:
        print(f"BTC depth frames: {len(depth_times)}, gap median {statistics.median(gaps) * 1000:.0f} ms, max {max(gaps) * 1000:.0f} ms, wire bytes median {statistics.median(depth_sizes):.0f}")
    print("levels per frame (bids, asks):", dict(levels), "ordered:", orders_ok, "frames equal to the one before:", same_frames)
    print("ts values distinct:", len(set(frames_with_ts)), "of", len(frames_with_ts), "keys of the last tick:", list(tick) if depth_times else None)
    print("socket top 3 against REST top 3 read during the run:", rest_check)


async def mode_all() -> None:
    print(f"\n# all, {now()}")
    listed = [row for row in web_list() if row["contractType"] == "E"]
    subs = [row["subSymbol"] for row in listed]
    ws = await connect()
    for raw in subs:
        await ws.send(sub(f"market_{raw}_depth_step0", raw))
        await ws.send(sub(f"mark_price_{raw}", raw))
    print(f"{now()} sent {2 * len(subs)} subscriptions for {len(subs)} contracts")
    books, marks, counts = collections.Counter(), {}, collections.Counter()
    first_book_at = {}
    started = time.time()
    other = collections.Counter()
    end = started + 60
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
    print(f"contracts with a book frame: {len(books)} of {len(subs)}, last first book at {max(first_book_at.values()):.1f} s")
    print(f"book frames per contract in 60 s: min {min(books.values())}, median {statistics.median(books.values())}, max {max(books.values())}, total {sum(books.values())}")
    silent = sorted(set(subs) - set(books))
    print("no book frame:", silent[:20])
    print(f"contracts with a mark frame: {len(marks)} of {len(subs)}, frames per contract median {statistics.median(counts.values()) if counts else 0}, max {max(counts.values()) if counts else 0}")
    print("mark tick keys:", collections.Counter(tuple(sorted(tick)) for tick in marks.values()).most_common(2))
    nexts = collections.Counter(tick.get("nextSettlementTime") for tick in marks.values())
    print("nextSettlementTime values:", nexts.most_common())
    by_raw = {row["subSymbol"]: row for row in listed}
    agree = sum(str(by_raw[raw]["nextCapitalSettTime"]) == str(tick.get("nextSettlementTime")) for raw, tick in marks.items() if raw in by_raw)
    print(f"nextSettlementTime equals the web list's nextCapitalSettTime on {agree} of {len(marks)}")
    print("other frames:", other.most_common(5))


async def mode_silence() -> None:
    print(f"\n# silence, {now()}")
    ws = await connect()
    await ws.send(sub("market_e_btcusdt_depth_step0"))
    started = time.time()
    pings, frames, closed = [], 0, None
    while time.time() - started < 90:
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
    print(f"sent nothing after the subscription for 90 s: {frames} frames, server pings {pings[:6]}, closed {closed}")


async def mode_pong() -> None:
    print(f"\n# pong, {now()}")
    ws = await connect()
    await ws.send(sub("market_e_btcusdt_depth_step0"))
    started = time.time()
    replies, sent, closed = [], 0, None
    next_pong = started
    while time.time() - started < 50:
        if time.time() >= next_pong:
            await ws.send(json.dumps({"pong": int(time.time() * 1000)}))
            sent += 1
            next_pong += 15
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=1)
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as error:
            closed = f"{error.code} {error.reason!r}"
            break
        text, data, _, _ = decode(message)
        if data and ("ping" in data or "pong" in data):
            replies.append((round(time.time() - started, 1), text))
    await ws.send(json.dumps({"ping": int(time.time() * 1000)}))
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
    print(f"sent {sent} pong frames 15 s apart, keepalive frames back: {replies}, closed {closed}")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else "all-modes"
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"), "mode", mode)
    modes = {"basic": mode_basic, "all": mode_all, "silence": mode_silence, "pong": mode_pong}
    for name, run in modes.items():
        if mode in (name, "all-modes"):
            asyncio.run(run())


if __name__ == "__main__":
    main()
