# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=14,<16"]
# ///
"""Read-only WebSocket probe for Binance TH spot, for docs/profiles/binance-th/websocket.md.

Public market streams only, no listen key, no account.
Every socket refuses permessage-deflate, as the engine does, and logs control frames by wrapping
the protocol's frame handler, so server pings are counted while the library still answers them.
Stays inside the documented limit of 5 incoming messages per second per connection.

Modes, each runnable alone:
  open      one stream per URL against several, a SUBSCRIBE frame of several, the other stream kinds
  diff      diff depth on a SITE and a GLOBAL pair, sequence continuity, REST alignment, server pings
  partial   depth5, depth10 and depth20 at 1000 ms and 100 ms, cadence, level counts, idle repeats
  control   SUBSCRIBE, LIST_SUBSCRIPTIONS, unknown and wrong-form streams, bad frames, path variants
  fanout    300 diff depth streams on one socket by SUBSCRIBE frames
  all       every mode above, about four minutes of socket time
Run from the repository root: uv run scripts/probes/venues/binance-th/ws-probe.py [mode]
Captures go to .claude/survey-work/binance-th/.
"""

import asyncio
import collections
import json
import sys
import time
import urllib.request
from pathlib import Path

import websockets
from websockets.frames import Opcode

WORK = Path(".claude/survey-work/binance-th")
BASE = "wss://nbstream.binance.th/w3w/wsa/stream"
REST = "https://api.binance.th/api/v1"
SITE = "btcthb"
GLOBAL = "btcusdt"


def now_ms() -> int:
    return int(time.time() * 1000)


def save(name: str, obj) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(obj, indent=1))


def rest(path: str):
    with urllib.request.urlopen(urllib.request.Request(REST + path, headers={"User-Agent": "survey-probe/1.0"}), timeout=30) as reply:
        return json.load(reply)


async def connect(url: str, controls: list | None = None):
    ws = await websockets.connect(url, compression=None, ping_interval=None, max_size=2**24, open_timeout=20)
    if controls is not None:
        original = ws.protocol.recv_frame

        def recv_frame(frame):
            if frame.opcode in (Opcode.PING, Opcode.PONG, Opcode.CLOSE):
                controls.append((now_ms(), frame.opcode.name, bytes(frame.data)[:60]))
            return original(frame)

        ws.protocol.recv_frame = recv_frame
    return ws


async def collect(ws, seconds: float) -> list:
    frames = []
    end = time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as closed:
            frames.append((now_ms(), {"_closed": str(closed)}))
            break
        frames.append((now_ms(), json.loads(raw) if isinstance(raw, str) else {"_binary": len(raw)}))
    return frames


async def mode_open() -> None:
    print("== open, one stream per URL against several streams in one URL")
    start = time.perf_counter()
    ws = await connect(f"{BASE}?streams={SITE}@bookTicker")
    print(f"single stream URL opened in {(time.perf_counter() - start) * 1000:.0f} ms")
    headers = ws.response.headers
    for key in ("server", "sec-websocket-extensions", "via", "x-cache", "x-amz-cf-pop"):
        print(f"  upgrade header {key}: {headers.get(key)}")
    frames = await collect(ws, 5)
    await ws.close()
    print(f"  {len(frames)} frames in 5 s, first {json.dumps(frames[0][1])}, second {json.dumps(frames[1][1])[:300] if len(frames) > 1 else None}")
    save("ws-open.json", [f for _, f in frames[:3]])
    for query in (f"?streams={GLOBAL}@bookTicker/eth{GLOBAL[3:]}@bookTicker",
                  f"?streams={SITE}@depth20@100ms/usdtthb@depth20@100ms",
                  f"?streams={SITE}@depth@100ms/{SITE}@depth20@100ms",
                  f"?streams={GLOBAL}@bookTicker%2Feth{GLOBAL[3:]}@bookTicker"):
        ws = await connect(BASE + query)
        frames = await collect(ws, 6)
        await ws.close()
        data = sum(1 for _, f in frames if "data" in f)
        print(f"URL {query}: {len(frames)} frames in 6 s, {data} data frames, non data {[f for _, f in frames if 'data' not in f][:2]}")
    ws = await connect(BASE)
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": [f"{GLOBAL}@bookTicker", f"eth{GLOBAL[3:]}@bookTicker", f"{SITE}@depth20@100ms", f"{SITE}@bookTicker"], "id": 1}))
    frames = await collect(ws, 6)
    await ws.close()
    counts = collections.Counter(f.get("stream") for _, f in frames)
    print(f"bare URL plus one SUBSCRIBE frame of 4 streams: {len(frames)} frames in 6 s by stream {dict(counts)}")
    first = {}
    for _, f in frames:
        first.setdefault(f.get("stream"), f)
    for stream, f in first.items():
        print(f"  first {stream}: {json.dumps(f)[:300]}")
    for stream in (f"{SITE}@trade", f"{SITE}@aggTrade", f"{SITE}@ticker", f"{SITE}@miniTicker", f"{GLOBAL}@trade", "!bookTicker", "!miniTicker@arr"):
        ws = await connect(f"{BASE}?streams={stream}")
        frames = await collect(ws, 4)
        await ws.close()
        data = [f for _, f in frames if "data" in f]
        print(f"URL {stream}: {len(data)} data frames in 4 s, first {json.dumps(data[0])[:200] if data else None}")


def sides(d: dict) -> tuple[list, list]:
    return d.get("bids", d.get("b", [])), d.get("asks", d.get("a", []))


def ordered(levels: list, descending: bool) -> bool:
    prices = [float(p) for p, _ in levels]
    return all((a > b) if descending else (a < b) for a, b in zip(prices, prices[1:]))


def check_diff(frames: list, snapshot: dict, after: dict, label: str) -> None:
    events = [f["data"] for _, f in frames if "data" in f and f["data"].get("e") == "depthUpdate"]
    if not events:
        print(f"{label}: no depthUpdate events")
        return
    gaps = sum(1 for a, b in zip(events, events[1:]) if b["U"] != a["u"] + 1)
    has_pu = all("pu" in e for e in events)
    pu_breaks = sum(1 for a, b in zip(events, events[1:]) if b.get("pu") != a["u"]) if has_pu else None
    spans = [e["u"] - e["U"] + 1 for e in events]
    empty = sum(1 for e in events if not e["b"] and not e["a"])
    zeros = sum(1 for e in events for lvl in e["b"] + e["a"] if float(lvl[1]) == 0)
    multi_b = [e["b"] for e in events if len(e["b"]) > 1]
    multi_a = [e["a"] for e in events if len(e["a"]) > 1]
    intervals = [b["E"] - a["E"] for a, b in zip(events, events[1:])]
    lag = sorted(t - f["data"]["E"] for t, f in frames if "data" in f and "E" in f["data"])
    for a, b in [(a, b) for a, b in zip(events, events[1:]) if b["U"] != a["u"] + 1 and "pu" not in b][:3]:
        print(f"  break: previous E {a['E']} U {a['U']} u {a['u']}, next E {b['E']} U {b['U']} u {b['u']}")
    print(f"{label}: {len(events)} events, keys {sorted(events[0])}, U != prev u + 1 in {gaps}, pu present {has_pu}, pu != prev u in {pu_breaks}, "
          f"span u-U+1 min {min(spans)} median {sorted(spans)[len(spans) // 2]} max {max(spans)}")
    print(f"  events with both sides empty {empty}, zero size levels {zeros}, multi level bids descending {sum(ordered(b, True) for b in multi_b)} "
          f"ascending {sum(ordered(b, False) for b in multi_b)} of {len(multi_b)}, multi level asks ascending {sum(ordered(a, False) for a in multi_a)} of {len(multi_a)}")
    if intervals:
        print(f"  E interval ms min {min(intervals)} median {sorted(intervals)[len(intervals) // 2]} max {max(intervals)}, receive minus E median {lag[len(lag) // 2]} ms")
    last_id = snapshot["lastUpdateId"]
    kept = [e for e in events if e["u"] > last_id]
    if not kept:
        print(f"  REST lastUpdateId {last_id}: every buffered event was older")
        return
    e = kept[0]
    print(f"  REST lastUpdateId {last_id}: dropped {len(events) - len(kept)} events with u <= lastUpdateId, first kept U {e['U']} u {e['u']} pu {e.get('pu')}, "
          f"U <= lastUpdateId+1 <= u {e['U'] <= last_id + 1 <= e['u']}, pu == lastUpdateId {e.get('pu') == last_id}")
    bids = dict(snapshot["bids"])
    asks = dict(snapshot["asks"])
    for e in kept:
        if e["u"] > after["lastUpdateId"]:
            break
        for book, levels in ((bids, e["b"]), (asks, e["a"])):
            for price, size in levels:
                if float(size) == 0:
                    book.pop(price, None)
                else:
                    book[price] = size
    applied_to = max((e["u"] for e in kept if e["u"] <= after["lastUpdateId"]), default=None)
    top_b = [list(x) for x in sorted(bids.items(), key=lambda x: -float(x[0]))[:20]]
    top_a = [list(x) for x in sorted(asks.items(), key=lambda x: float(x[0]))[:20]]
    print(f"  rebuilt book through u {applied_to} against a second REST read at lastUpdateId {after['lastUpdateId']}: "
          f"top 20 bids equal {top_b == after['bids']}, top 20 asks equal {top_a == after['asks']}")


async def mode_diff() -> None:
    print("== diff, REST snapshot 3 s after the open, second REST read at the end")
    for symbol, stream, seconds in ((SITE, f"{SITE}@depth@100ms", 45), (GLOBAL, f"{GLOBAL}@depth@100ms", 30), (SITE, f"{SITE}@depth", 15)):
        controls = []
        ws = await connect(f"{BASE}?streams={stream}", controls)
        task = asyncio.create_task(collect(ws, seconds))
        await asyncio.sleep(3)
        snapshot = rest(f"/depth?symbol={symbol.upper()}&limit=1000")
        frames = await task
        after = rest(f"/depth?symbol={symbol.upper()}&limit=20")
        await ws.close()
        check_diff(frames, snapshot, after, f"{stream} for {seconds} s")
        print(f"  control frames from the server in {seconds} s: {controls}")
        if stream == f"{SITE}@depth@100ms":
            sample = [f for _, f in frames if "data" in f][:3]
            save("ws-diff-sample.json", sample)
            print(f"  sample frame {json.dumps(sample[0])[:300]}")


async def mode_partial() -> None:
    print("== partial depth")
    for stream, seconds in ((f"{SITE}@depth20@100ms", 12), (f"{SITE}@depth20", 12), (f"{SITE}@depth5", 5), (f"{SITE}@depth10@100ms", 5),
                            (f"{GLOBAL}@depth20@100ms", 8), ("eththb@depth20@100ms", 8), ("usdtthb@depth20@100ms", 12)):
        ws = await connect(f"{BASE}?streams={stream}")
        frames = await collect(ws, seconds)
        await ws.close()
        data = [(t, f["data"]) for t, f in frames if "data" in f]
        if not data:
            print(f"{stream}: no data frames in {seconds} s, other frames {frames[:2]}")
            continue
        books = [sides(d) for _, d in data]
        ids = [d.get("lastUpdateId") for _, d in data]
        repeats = sum(1 for a, b in zip(books, books[1:]) if a == b)
        same_id = sum(1 for a, b in zip(ids, ids[1:]) if a == b)
        recv = [t for t, _ in data]
        gaps = sorted(b - a for a, b in zip(recv, recv[1:]))
        levels = collections.Counter((len(b), len(a)) for b, a in books)
        order = sum(1 for b, a in books if ordered(b, True) and ordered(a, False))
        print(f"{stream}: {len(data)} frames in {seconds} s, keys {sorted(data[0][1])}, levels {dict(levels)}, bids descending and asks ascending in {order}, "
              f"receive gap ms median {gaps[len(gaps) // 2] if gaps else '-'}, identical book to previous {repeats}, same lastUpdateId as previous {same_id}")
        if stream == f"{SITE}@depth20@100ms":
            save("ws-partial-sample.json", frames[:2])


async def send_and_read(ws, frame, seconds: float = 3) -> list:
    await ws.send(frame if isinstance(frame, str) else json.dumps(frame))
    return [f for _, f in await collect(ws, seconds) if "data" not in f]


async def mode_control() -> None:
    print("== control")
    controls = []
    ws = await connect(BASE, controls)
    print(f"bare {BASE}: opened, frames in 3 s without a subscription: {len(await collect(ws, 3))}")
    print("SUBSCRIBE btcthb@depth20 and nopethb@depth:", await send_and_read(ws, {"method": "SUBSCRIBE", "params": [f"{SITE}@depth20", "nopethb@depth"], "id": 1}, 2))
    await asyncio.sleep(0.5)
    frames = await collect(ws, 3)
    print(f"  after subscribe, {len(frames)} frames in 3 s, streams {dict(collections.Counter(f.get('stream') for _, f in frames))}")
    await asyncio.sleep(0.5)
    print("LIST_SUBSCRIPTIONS:", await send_and_read(ws, {"method": "LIST_SUBSCRIPTIONS", "id": 2}, 1.5))
    await asyncio.sleep(0.5)
    print("SUBSCRIBE upper case BTCTHB@depth5:", await send_and_read(ws, {"method": "SUBSCRIBE", "params": ["BTCTHB@depth5"], "id": 3}, 2))
    await asyncio.sleep(0.5)
    print("UNSUBSCRIBE btcthb@depth20:", await send_and_read(ws, {"method": "UNSUBSCRIBE", "params": [f"{SITE}@depth20"], "id": 4}, 1.5))
    await asyncio.sleep(0.5)
    print("LIST_SUBSCRIPTIONS:", await send_and_read(ws, {"method": "LIST_SUBSCRIPTIONS", "id": 5}, 1.5))
    await asyncio.sleep(0.5)
    print("SUBSCRIBE id as string:", await send_and_read(ws, {"method": "SUBSCRIBE", "params": [f"{SITE}@trade"], "id": "x"}, 1.5))
    await asyncio.sleep(0.5)
    print("bad method:", await send_and_read(ws, {"method": "NOPE", "params": [], "id": 6}, 1.5))
    await asyncio.sleep(0.5)
    print("GET_PROPERTY combined:", await send_and_read(ws, {"method": "GET_PROPERTY", "params": ["combined"], "id": 7}, 1.5))
    await asyncio.sleep(0.5)
    print("not JSON:", await send_and_read(ws, "hello", 2))
    print(f"  socket state after the bad frames: {ws.state.name}, control frames seen {controls}")
    await ws.close()

    for label, url in (("unknown symbol in URL", f"{BASE}?streams=nopethb@depth"),
                       ("upper case symbol in URL", f"{BASE}?streams=BTCTHB@depth5"),
                       ("wrong form BTC_THB in URL", f"{BASE}?streams=btc_thb@depth5"),
                       ("depth15, an undocumented level count", f"{BASE}?streams={SITE}@depth15"),
                       ("raw path /w3w/wsa/ws/btcthb@depth5", "wss://nbstream.binance.th/w3w/wsa/ws/btcthb@depth5"),
                       ("raw path /ws/btcthb@depth5", "wss://nbstream.binance.th/ws/btcthb@depth5"),
                       ("Binance style /stream?streams=", "wss://nbstream.binance.th/stream?streams=btcthb@depth5"),
                       ("stream.binance.th host", "wss://stream.binance.th/w3w/wsa/stream?streams=btcthb@depth5")):
        try:
            ws = await connect(url)
        except Exception as error:  # noqa: BLE001, a refused upgrade is the finding
            print(f"{label}: refused {type(error).__name__} {str(error)[:200]}")
            continue
        frames = await collect(ws, 4)
        await ws.close()
        print(f"{label}: upgraded, {len(frames)} frames in 4 s, first {json.dumps(frames[0][1])[:200] if frames else None}")


async def mode_fanout() -> None:
    print("== fanout, 300 diff depth streams by SUBSCRIBE frames of 100, 1.5 s apart")
    info = rest("/exchangeInfo")
    names = [s["symbol"].lower() + "@depth" for s in info["symbols"]][:300]
    ws = await connect(BASE)
    replies = []
    for i in range(3):
        await ws.send(json.dumps({"method": "SUBSCRIBE", "params": names[i * 100:(i + 1) * 100], "id": 10 + i}))
        replies += [f for _, f in await collect(ws, 1.5) if "data" not in f]
    frames = await collect(ws, 10)
    await ws.close()
    streams = {f.get("stream") for _, f in frames if "data" in f}
    print(f"replies {replies}, then {len(frames)} frames in 10 s from {len(streams)} distinct streams")


MODES = {"open": mode_open, "diff": mode_diff, "partial": mode_partial, "control": mode_control, "fanout": mode_fanout}


async def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, websockets {websockets.__version__}")
    for name, fn in MODES.items():
        if mode in ("all", name):
            await fn()


if __name__ == "__main__":
    asyncio.run(main())
