# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Read-only public WebSocket probe for OneEx, behind docs/profiles/oneex/websocket.md.

Run from the repository root with: uv run scripts/probes/venues/oneex/ws-probe.py
Three sockets run at once and close on their own: detail (about 60 s), all markets (25 s) and silence (at most 70 s).
That keeps one run near 1.5 minutes of wall time and about 2.6 minutes of socket time.
"""

import asyncio
import base64
import json
import os
import socket
import ssl
import statistics
import threading
import time
import urllib.request
import zlib
from collections import Counter, defaultdict

import websockets

URL = "wss://ws.oneex.vip/ws/quote/v1?lang=en-us"  # the website builds this from its host, www replaced by ws
WEB = "https://www.oneex.vip"
ORIGIN = "https://www.oneex.vip"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
DETAIL_SECONDS = 50
ALL_SECONDS = 25
SILENCE_SECONDS = 70
EX = "301"  # exchangeId that prefixes every symbol on the socket and the REST book


def tradable_symbols():
    req = urllib.request.Request(WEB + "/s_api/basic/config_v2?tab=exchange&type=all", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.loads(r.read())
    return [s["symbolId"] for s in data["futuresSymbol"] if s["status"] and s["canTrade"]]


def vnum(v):
    return int(str(v).split("_")[0])


async def connect():
    t0 = time.perf_counter()
    ws = await websockets.connect(
        URL,
        user_agent_header=UA,
        origin=ORIGIN,
        compression=None,  # the engine refuses permessage-deflate, so the probe does too
        max_size=None,
        ping_interval=None,  # no library control pings, so silence means silence
    )
    return ws, (time.perf_counter() - t0) * 1000


def sub(topic, symbol, sid, **params):
    frame = {"id": sid, "topic": topic, "event": "sub", "params": {"binary": False, **params}}
    if symbol is not None:
        frame["symbol"] = symbol
    return frame


def trim(raw, n=420):
    return raw if len(raw) <= n else raw[:n] + f"...(+{len(raw) - n} chars)"


def apply(book, levels):
    for price, size in levels:
        if float(size) == 0:
            book.pop(price, None)
        else:
            book[price] = size


def top(book, reverse, n):
    return [[p, book[p]] for p in sorted(book, key=float, reverse=reverse)[:n]]


async def detail():
    ws, ms = await connect()
    print(f"[detail] connected in {ms:.0f} ms, status {ws.response.status_code}, extensions header {ws.response.headers.get('Sec-WebSocket-Extensions')}, server {ws.response.headers.get('Server')}")
    # Each odd frame goes alone with 0.7 s to answer, because error frames carry no id.
    odd = [
        ("unknown symbol", sub("depth", f"{EX}.FOO-SWAP-USDT", "unknown")),
        ("closed USDH row", sub("depth", f"{EX}.BTC-SWAP-USDH", "closed-usdh")),
        ("no 301. prefix", sub("depth", "BTC-SWAP-USDT", "no-prefix")),
        ("comma list on markKline_1m", sub("markKline_1m", "BTCUSDT,ETHUSDT", "mark-comma", klineType="1m")),
        ("no symbol", {"id": "nosym", "topic": "depth", "event": "sub", "params": {"binary": False}}),
        ("not JSON", "not json"),
        (f"ping {int(time.time() * 1000)}", {"ping": int(time.time() * 1000)}),
        ("sub then cancel", sub("depth", f"{EX}.LTC-SWAP-USDT", "ltc")),
        ("text depth on XRP, which the binary one below should replace", sub("depth", f"{EX}.XRP-SWAP-USDT", "xrp-text")),
        ("cancel", {"id": "ltc", "topic": "depth", "event": "cancel", "symbol": f"{EX}.LTC-SWAP-USDT", "params": {"binary": False}}),
    ]
    for label, f in odd:
        await ws.send(f if isinstance(f, str) else json.dumps(f))
        got = []
        t_end = time.time() + 0.7
        while time.time() < t_end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.01, t_end - time.time()))
            except asyncio.TimeoutError:
                break
            got.append(trim(raw if isinstance(raw, str) else repr(raw[:40]), 160))
        print(f"[detail] {label}: {len(got)} frames back in 0.7 s: {got}")
    t_quiet = time.time()
    after_cancel = 0
    while time.time() - t_quiet < 4:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
        except asyncio.TimeoutError:
            continue
        if isinstance(raw, str) and "LTC" in raw:
            after_cancel += 1
    print(f"[detail] LTC frames in the 4 s after the cancel: {after_cancel}")

    frames = [
        sub("depth", f"{EX}.BTC-SWAP-USDT", "depth-btc"),
        sub("depth", f"{EX}.SOL-SWAP-USDT", "depth-sol-limit5", limit=5),
        sub("diffDepth", f"{EX}.BTC-SWAP-USDT,{EX}.ETH-SWAP-USDT", "diff"),
        sub("depth", f"{EX}.ETH-SWAP-USDT", "depth-eth"),
        sub("mergedDepth", f"{EX}.BTC-SWAP-USDT", "merged-btc", dumpScale=1),
        sub("markKline_1m", "BTCUSDT", "mark-btc", klineType="1m"),
        sub("indexKline_1m", "BTCUSDT", "index-btc", klineType="1m"),
        sub("depth", f"{EX}.BTC-SWAP-USDT", "depth-btc"),  # the same id twice
        {"id": "xrp-binary", "topic": "depth", "event": "sub", "symbol": f"{EX}.XRP-SWAP-USDT", "params": {"binary": True}},
    ]
    for f in frames:
        await ws.send(json.dumps(f))

    t0 = time.time()
    arrivals = defaultdict(list)
    first = {}
    nonbook = []
    levels = defaultdict(Counter)
    versions = defaultdict(list)
    diff_books = {}
    diff_first = {}
    o_values = []
    captured = {}  # (topic, kind) to one BTC frame with two levels a side, for the profile
    last_o = {}
    o_steps = defaultdict(Counter)  # symbol to {o step between consecutive deltas: count}
    order_ok = Counter()
    crossed = 0
    depth_frames = defaultdict(dict)  # symbol to {v: (bids, asks)} from the depth topic
    diff_tops = defaultdict(dict)  # symbol to {v: (bids, asks)} rebuilt from diffDepth
    binary_note = None
    bytes_in = 0
    pings_seen = []
    while time.time() - t0 < DETAIL_SECONDS:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=DETAIL_SECONDS - (time.time() - t0) + 0.1)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            print(f"[detail] closed early: code {e.code} reason {e.reason!r}")
            break
        now = time.time() - t0
        if isinstance(raw, bytes):
            bytes_in += len(raw)
            if binary_note is None:
                for name, fn in [("zlib", zlib.decompress), ("raw deflate", lambda b: zlib.decompress(b, -15)), ("gzip", lambda b: zlib.decompress(b, 31))]:
                    try:
                        text = fn(raw).decode()
                        binary_note = f"binary frame {len(raw)} bytes, {name} inflates to {len(text)} chars: {trim(text, 200)}"
                        break
                    except Exception:
                        continue
                binary_note = binary_note or f"binary frame {len(raw)} bytes, first bytes {raw[:16]!r}, no inflate worked"
            try:
                inner = json.loads(zlib.decompress(raw, 31))
                arrivals[(inner.get("id"), inner.get("symbol"), "binary")].append(now)
            except Exception:
                arrivals["binary, not gzip JSON"].append(now)
            continue
        bytes_in += len(raw)
        try:
            msg = json.loads(raw)
        except json.JSONDecodeError:
            nonbook.append((round(now, 2), trim(raw)))
            continue
        if "pong" in msg or "ping" in msg:
            if "ping" in msg:
                pings_seen.append(round(now, 2))
            nonbook.append((round(now, 2), trim(raw)))
            continue
        key = msg.get("id") or msg.get("topic")
        if "data" not in msg:
            nonbook.append((round(now, 2), trim(raw)))
            continue
        topic = msg.get("topic")
        arrivals[(key, msg.get("symbol"))].append(now)
        if (key, msg.get("symbol")) not in first:
            first[(key, msg.get("symbol"))] = trim(raw, 700)
        if topic in ("depth", "diffDepth") and msg.get("data"):
            d0 = msg["data"][0]
            label = "snapshot" if topic == "depth" else ("delta" if d0.get("e") == 0 else "first")
            if (topic, label) not in captured and key in ("depth-btc", "diff") and msg.get("symbol") == "BTC-SWAP-USDT":
                cut = dict(msg, data=[dict(d0, b=d0.get("b", [])[:2], a=d0.get("a", [])[:2])])
                captured[(topic, label)] = json.dumps(cut, separators=(",", ":"))
        for d in msg["data"]:
            if topic in ("depth", "diffDepth", "mergedDepth"):
                sym = msg.get("symbol")
                bids, asks = d.get("b", []), d.get("a", [])
                levels[(key, sym)][(len(bids), len(asks))] += 1
                versions[(key, sym)].append(d["v"])
                if topic == "depth" and key in ("depth-btc", "depth-eth"):
                    bp = [float(p) for p, _ in bids]
                    ap = [float(p) for p, _ in asks]
                    order_ok[(bp == sorted(bp, reverse=True), ap == sorted(ap))] += 1
                    if bp and ap and bp[0] >= ap[0]:
                        crossed += 1
                    depth_frames[sym][d["v"]] = (bids[:20], asks[:20])
                if topic == "diffDepth":
                    if "o" in d:
                        o_values.append((sym, d.get("e"), d["o"], d["v"]))
                        if d.get("e") == 0 and sym in last_o:
                            o_steps[sym][d["o"] - last_o[sym]] += 1
                        last_o[sym] = d["o"]
                    if sym not in diff_books or d.get("e") == int(EX):
                        diff_books[sym] = ({}, {})
                        diff_first.setdefault(sym, (d.get("e"), len(bids), len(asks), d["v"]))
                    b, a = diff_books[sym]
                    apply(b, bids)
                    apply(a, asks)
                    diff_tops[sym][d["v"]] = (top(b, True, 20), top(a, False, 20))
    await ws.close()

    print(f"[detail] ran {DETAIL_SECONDS} s, {bytes_in} bytes in")
    print("[detail] non-book frames (time s, text):")
    for t, text in nonbook:
        print(f"   {t}: {text}")
    print(f"[detail] server ping frames seen: {pings_seen}")
    print(f"[detail] binary subscription: {binary_note}")
    print(f"[detail] text frames for xrp-text after the binary XRP subscription: {len(arrivals.get(('xrp-text', 'XRP-SWAP-USDT'), []))}, binary XRP frames: {len(arrivals.get(('xrp-binary', 'XRP-SWAP-USDT', 'binary'), []))}")
    for k, ts in sorted(arrivals.items(), key=lambda kv: str(kv[0])):
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        g = f"median gap {statistics.median(gaps):.2f} s, max gap {max(gaps):.2f} s" if gaps else "one frame"
        print(f"[detail] {k}: {len(ts)} frames, first at {ts[0]:.2f} s, {g}")
    for k, c in sorted(levels.items(), key=lambda kv: str(kv[0])):
        print(f"[detail] level counts (bids, asks) for {k}: {dict(c.most_common(6))}")
    for k, vs in sorted(versions.items(), key=lambda kv: str(kv[0])):
        nums = [vnum(v) for v in vs]
        steps = [b - a for a, b in zip(nums, nums[1:])]
        suffix = Counter(str(v).split("_")[1] if "_" in str(v) else "" for v in vs)
        rising = all(s > 0 for s in steps)
        print(
            f"[detail] v for {k}: {len(vs)} frames, suffixes {dict(suffix)}, strictly rising {rising}, "
            f"repeats {sum(1 for s in steps if s == 0)}, step min {min(steps) if steps else None} median {statistics.median(steps) if steps else None} max {max(steps) if steps else None}"
        )
    print(f"[detail] depth topic order (bids descending, asks ascending): {dict(order_ok)}, crossed frames {crossed}")
    print(f"[detail] diffDepth first frame per symbol (e, bids, asks, v): {diff_first}")
    print(f"[detail] diffDepth o step between consecutive deltas, per symbol: { {k: dict(v) for k, v in o_steps.items()} }")
    print(f"[detail] diffDepth o field, first 6 (symbol, e, o, v): {o_values[:6]}, distinct o per symbol: { {s: len({o for ss, _, o, _ in o_values if ss == s}) for s in {x[0] for x in o_values}} }")
    for sym in diff_tops:
        common = sorted(set(diff_tops[sym]) & set(depth_frames.get(sym, {})), key=vnum)
        same = sum(1 for v in common if diff_tops[sym][v] == depth_frames[sym][v])
        print(f"[detail] {sym}: rebuilt diffDepth top 20 equals the depth topic frame of the same v on {same} of {len(common)} shared versions")
        for v in common:
            if diff_tops[sym][v] != depth_frames[sym][v]:
                rb, ra = diff_tops[sym][v]
                db, da = depth_frames[sym][v]
                print(f"   first mismatch at v {v}: rebuilt best {rb[:2]} / {ra[:2]}, depth best {db[:2]} / {da[:2]}")
                break
    for k, text in captured.items():
        print(f"[detail] captured {k}, cut to two levels a side: {text}")
    for k, text in first.items():
        if k[0] in ("depth-btc", "diff", "mark-btc", "index-btc", "mark-comma", "depth-sol-limit5", "merged-btc"):
            print(f"[detail] first frame of {k}: {text}")


async def all_markets(symbols):
    ws, ms = await connect()
    print(f"[all] connected in {ms:.0f} ms, subscribing depth for {len(symbols)} symbols in one comma list frame")
    await ws.send(json.dumps(sub("depth", ",".join(f"{EX}.{s}" for s in symbols), "all")))
    t0 = time.time()
    count = Counter()
    first_levels = {}
    nbytes = 0
    frames = 0
    pinged = time.time()
    while time.time() - t0 < ALL_SECONDS:
        if time.time() - pinged > 15:
            await ws.send(json.dumps({"ping": int(time.time() * 1000)}))
            pinged = time.time()
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=1.0)
        except asyncio.TimeoutError:
            continue
        except websockets.ConnectionClosed as e:
            print(f"[all] closed early: code {e.code} reason {e.reason!r}")
            break
        nbytes += len(raw)
        msg = json.loads(raw)
        if "data" not in msg:
            print(f"[all] non-book frame: {trim(raw if isinstance(raw, str) else str(raw))}")
            continue
        frames += 1
        sym = msg.get("symbol")
        count[sym] += 1
        if sym not in first_levels:
            d = msg["data"][0]
            first_levels[sym] = (len(d["b"]), len(d["a"]))
    await ws.close()
    elapsed = time.time() - t0
    print(f"[all] {frames} book frames in {elapsed:.0f} s, {frames / elapsed:.1f} frames/s, {nbytes / elapsed / 1024:.1f} KB/s")
    print(f"[all] symbols that pushed: {len(count)} of {len(symbols)}, silent: {sorted(set(symbols) - set(count))}")
    print(f"[all] frames per symbol: min {min(count.values())}, median {statistics.median(count.values())}, max {max(count.values())}")
    print(f"[all] first frame level counts (bids, asks): {Counter(first_levels.values()).most_common(8)}")
    print(f"[all] symbols whose first frame was empty on both sides: {sorted(s for s, (b, a) in first_levels.items() if b == 0 and a == 0)}")
    print(f"[all] symbols whose first frame held fewer than 20 levels on a side: {sorted(s for s, (b, a) in first_levels.items() if b < 20 or a < 20)}")


async def silence():
    ws, ms = await connect()
    await ws.send(json.dumps(sub("depth", f"{EX}.BTC-SWAP-USDT", "silence")))
    t0 = time.time()
    frames = 0
    pings = []
    last = t0
    while time.time() - t0 < SILENCE_SECONDS:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=SILENCE_SECONDS - (time.time() - t0) + 0.1)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            rcvd = e.rcvd
            print(f"[silence] server closed after {time.time() - t0:.1f} s of client silence, close frame {rcvd.code if rcvd else None} {rcvd.reason if rcvd else ''!r}, last frame at {last - t0:.1f} s, {frames} frames, pings {pings}")
            return
        last = time.time()
        frames += 1
        if isinstance(raw, str) and "ping" in raw:
            pings.append((round(last - t0, 1), raw[:60]))
    print(f"[silence] still open after {time.time() - t0:.0f} s with no client frame after the subscribe, {frames} frames, server pings {pings}")
    await ws.close()


def raw_handshake():
    """One plain HTTP upgrade request, returning the socket and the response head as text."""
    host = "ws.oneex.vip"
    s = ssl.create_default_context().wrap_socket(socket.create_connection((host, 443), timeout=10), server_hostname=host)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall(
        (
            f"GET /ws/quote/v1?lang=en-us HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Extensions: permessage-deflate; client_max_window_bits\r\nOrigin: {ORIGIN}\r\nUser-Agent: {UA}\r\n\r\n"
        ).encode()
    )
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = s.recv(4096)
        if not chunk:
            break
        head += chunk
    return s, head.decode("latin-1")


def handshake_burst(n=3):
    """n upgrade requests sent at the same instant from n threads, each socket held 2 s, to show the CDN's answer to a burst."""
    results = []

    def one(i):
        try:
            s, head = raw_handshake()
            results.append((i, head.split("\r\n")[0], " ".join(head.split("\r\n")[1:]).strip()))
            time.sleep(2)
            s.close()
        except OSError as e:
            results.append((i, repr(e), ""))

    threads = [threading.Thread(target=one, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(f"[burst] {n} simultaneous upgrade requests, each offering permessage-deflate:")
    for i, status, rest in sorted(results):
        print(f"   {i}: {status!r} headers {rest[:200]!r}")


async def staggered(delay, coro):
    await asyncio.sleep(delay)
    await coro


async def main():
    print(f"OneEx WS probe, local start {time.strftime('%Y-%m-%d %H:%M:%S %Z')}, UTC {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}, websockets {websockets.__version__}")
    symbols = tradable_symbols()
    print(f"tradable perpetuals from config_v2: {len(symbols)}")
    for _ in range(3):
        handshake_burst()
        time.sleep(3)
    # Connects are 1.5 s apart, because handshakes that arrive together draw status 929 from the CDN.
    await asyncio.gather(detail(), staggered(1.5, all_markets(symbols)), staggered(3.0, silence()))


if __name__ == "__main__":
    asyncio.run(main())
