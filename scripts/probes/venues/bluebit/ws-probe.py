# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""BlueBit public spot WebSocket probe for docs/profiles/bluebit/websocket.md.

Public, unauthenticated and read-only.
Holds one socket at a time, about four minutes of socket time in total.
Run from the repository root with: uv run scripts/probes/venues/bluebit/ws-probe.py
"""

import asyncio
import collections
import gzip
import json
import statistics
import time
import urllib.request

import websockets

URL = "wss://ws.bluebit.io/kline-api/ws"  # wsUrl in https://www.bluebit.io/fePublicInfo
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
LIVE = [
    "bluesparrowusdt", "btcusdt", "ethusdt", "xrpusdt", "bnbusdt", "solusdt", "usdcusdt",
    "dogeusdt", "trxusdt", "adausdt", "linkusdt", "bchusdt", "tonusdt", "shibusdt",
    "ltcusdt", "pepeusdt", "uniusdt", "aaveusdt", "polusdt", "xautusdt",
]  # the 20 symbols of fePublicInfo market.USDT on 2026-10-09


def sub(channel: str, cb_id: str = "probe") -> str:
    return json.dumps({"event": "sub", "params": {"channel": channel, "cb_id": cb_id}})


def decode(raw) -> tuple[str, int, str]:
    """Return text, wire bytes and the frame kind: gzip, binary-plain or text."""
    if isinstance(raw, bytes):
        if raw[:2] == b"\x1f\x8b":
            return gzip.decompress(raw).decode("utf-8", "replace"), len(raw), "gzip"
        return raw.decode("utf-8", "replace"), len(raw), "binary-plain"
    return raw, len(raw), "text"


async def connect(compression=None):
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, compression=compression, open_timeout=15, user_agent_header=UA, max_size=2**22)
    return ws, (time.perf_counter() - t0) * 1000


async def collect(ws, seconds: float, answer_ping: bool = True):
    """Return a list of (elapsed s, text, wire bytes, binary) and the close reason if any."""
    out, t0, closed = [], time.perf_counter(), None
    end = t0 + seconds
    while (left := end - time.perf_counter()) > 0:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as err:
            closed = (round(time.perf_counter() - t0, 1), err.rcvd.code if err.rcvd else None, err.rcvd.reason if err.rcvd else None)
            break
        text, size, binary = decode(raw)
        out.append((time.perf_counter() - t0, text, size, binary))
        if answer_ping and text.startswith('{"ping"'):
            await ws.send(json.dumps({"pong": json.loads(text)["ping"]}))
    return out, closed


def trim(text: str, n: int = 300) -> str:
    return text if len(text) <= n else text[:n] + f"... ({len(text)} chars)"


async def mode_book():
    print("== mode book: market_btcusdt_depth_step0 for 40 s, pings answered")
    ws, open_ms = await connect()
    print(f"open {open_ms:.0f} ms, status {ws.response.status_code}, extensions header {ws.response.headers.get('sec-websocket-extensions')!r}")
    await ws.send(sub("market_btcusdt_depth_step0", "btcusdt"))
    frames, closed = await collect(ws, 40)
    await ws.close()
    book = [(t, json.loads(x), s, b) for t, x, s, b in frames if 'depth_step0"' in x]
    pings = [(t, json.loads(x)) for t, x, s, b in frames if x.startswith('{"ping"')]
    other = [x for t, x, s, b in frames if 'depth_step0"' not in x and not x.startswith('{"ping"')]
    print(f"frames {len(frames)}, book {len(book)}, pings {len(pings)}, other {len(other)}, closed {closed}")
    print(f"frame kinds: {dict(collections.Counter(b for _, _, _, b in frames))}")
    if book:
        first = book[0]
        print(f"first book frame {first[0] * 1000:.0f} ms after subscribe")
        f1 = first[1]
        sample = {**f1, "tick": {"asks": f1["tick"]["asks"][:3], "buys": f1["tick"]["buys"][:3]}}
        print("first book frame, three levels a side:", json.dumps(sample))
        print("top-level keys:", sorted(first[1]), " tick keys:", sorted(first[1]["tick"]))
        gaps = [b[0] - a[0] for a, b in zip(book, book[1:])]
        if gaps:
            print(f"book interval s: min {min(gaps):.2f}, median {statistics.median(gaps):.2f}, max {max(gaps):.2f}")
        bids_n = collections.Counter(len(f[1]["tick"].get("buys") or []) for f in book)
        asks_n = collections.Counter(len(f[1]["tick"].get("asks") or []) for f in book)
        print(f"bid level counts {dict(bids_n)}, ask level counts {dict(asks_n)}")
        ok_bids = all(all(a[0] > b[0] for a, b in zip(lv, lv[1:])) for lv in (f[1]["tick"].get("buys") or [] for f in book))
        ok_asks = all(all(a[0] < b[0] for a, b in zip(lv, lv[1:])) for lv in (f[1]["tick"].get("asks") or [] for f in book))
        print(f"bids strictly descending in every frame {ok_bids}, asks strictly ascending in every frame {ok_asks}")
        crossed = sum(1 for f in book if f[1]["tick"].get("buys") and f[1]["tick"].get("asks") and f[1]["tick"]["buys"][0][0] >= f[1]["tick"]["asks"][0][0])
        print(f"crossed frames {crossed}")
        tops = [(f[1]["tick"]["buys"][0][0], f[1]["tick"]["asks"][0][0]) for f in book if f[1]["tick"].get("buys") and f[1]["tick"].get("asks")]
        if tops:
            bid, ask = tops[-1]
            print(f"last top of book bid {bid} ask {ask}, spread {(ask - bid) / ((ask + bid) / 2) * 1e6:.0f} ppm")
            req = urllib.request.Request("https://openapi.bluebit.io/open/api/get_ticker?symbol=btcusdt", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=15) as resp:
                tk = json.loads(resp.read())["data"]
            print(f"REST get_ticker right after: buy {tk.get('buy')} sell {tk.get('sell')}, matches the socket top: {(tk.get('buy'), tk.get('sell')) == (bid, ask)}")
        sizes = collections.Counter(lv[1] for f in book for side in ("buys", "asks") for lv in f[1]["tick"].get(side) or [])
        print(f"most common level sizes (base units): {sizes.most_common(3)}")
        same = sum(1 for a, b in zip(book, book[1:]) if a[1]["tick"] == b[1]["tick"])
        print(f"consecutive frames with an identical tick: {same} of {len(book) - 1}")
        ts = [f[1].get("ts") for f in book]
        print(f"ts present {sum(t is not None for t in ts)}, ts strictly increasing {all(b > a for a, b in zip(ts, ts[1:]) if a and b)}")
        seq_like = [k for k in first[1]["tick"] if k not in ("asks", "buys")]
        print(f"tick fields other than asks and buys: {seq_like}")
        print(f"wire bytes per book frame: median {statistics.median(s for _, _, s, _ in book):.0f}")
    if pings:
        pg = [b[0] - a[0] for a, b in zip(pings, pings[1:])]
        print(f"ping frames: {pings[0][1]}, intervals s {[round(x, 1) for x in pg]}")
    for x in other[:3]:
        print("other frame:", trim(x))


async def mode_errors():
    print("\n== mode errors: unknown symbol, unknown channel, malformed event, plain-text frame")
    ws, open_ms = await connect()
    for frame in (
        sub("market_nosuchusdt_depth_step0"),
        sub("market_btcusdt_nosuch"),
        json.dumps({"event": "nosuch", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "x"}}),
        "hello",
    ):
        await ws.send(frame)
        frames, closed = await collect(ws, 4)
        texts = [(x, kind) for _, x, _, kind in frames if not x.startswith('{"ping"')]
        print(f"sent {frame!r}: {len(texts)} non-ping frames, closed {closed}")
        for x, kind in texts[:2]:
            print("   ", kind, trim(x))
        if closed:
            ws, _ = await connect()
    await ws.close()


async def mode_channels():
    print("\n== mode channels: depth steps, trades, ticker, kline, one req, 15 s")
    ws, _ = await connect()
    chans = [
        "market_btcusdt_depth_step1", "market_btcusdt_depth_step2", "market_btcusdt_trade_ticker",
        "market_btcusdt_ticker", "market_btcusdt_kline_1min",
    ]
    for c in chans:
        await ws.send(sub(c))
    await ws.send(json.dumps({"event": "req", "params": {"channel": "market_btcusdt_depth_step0", "cb_id": "r"}}))
    frames, closed = await collect(ws, 15)
    await ws.close()
    per = collections.defaultdict(list)
    for t, x, s, b in frames:
        d = json.loads(x)
        key = d.get("channel") or ("ping" if "ping" in d else "?")
        per[(key, d.get("event_rep"))].append(x)
    for (ch, rep), xs in per.items():
        levels = ""
        d = json.loads(xs[0])
        tick = d.get("tick") or {}
        if isinstance(tick, dict) and "asks" in tick:
            levels = f", levels bids {len(tick.get('buys') or [])} asks {len(tick.get('asks') or [])}"
        print(f"{ch} event_rep {rep!r}: {len(xs)} frames{levels}")
        print("   ", trim(xs[0], 400))
        if ch.endswith("trade_ticker"):
            tr = d["tick"]["data"][0]
            utc = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(tr["ts"] / 1000))
            print(f"    trade ds {tr['ds']!r} against ts {tr['ts']} = {utc} UTC")
    print(f"closed {closed}")


async def mode_many():
    print("\n== mode many: depth_step0 for all 20 live symbols on one socket, 25 s")
    ws, _ = await connect()
    for s in LIVE:
        await ws.send(sub(f"market_{s}_depth_step0", s))
    frames, closed = await collect(ws, 25)
    await ws.close()
    per = collections.Counter()
    empty = collections.Counter()
    for _, x, _, _ in frames:
        d = json.loads(x)
        ch = d.get("channel")
        if ch:
            per[ch] += 1
            t = d.get("tick") or {}
            if not t.get("buys") or not t.get("asks"):
                empty[ch] += 1
    print(f"symbols delivering {len(per)} of {len(LIVE)}, closed {closed}")
    for s in LIVE:
        ch = f"market_{s}_depth_step0"
        print(f"  {s}: {per.get(ch, 0)} frames, one-sided or empty {empty.get(ch, 0)}")


async def mode_doc_sub():
    print("\n== mode doc sub: the documented frame with asks 150 and bids 150, 12 s")
    ws, _ = await connect()
    await ws.send(json.dumps({"event": "sub", "params": {"channel": "market_ethusdt_depth_step0", "cb_id": "custom", "asks": 150, "bids": 150}}))
    frames, closed = await collect(ws, 12)
    await ws.close()
    acks = [x for _, x, _, _ in frames if '"subed"' in x]
    book = [json.loads(x) for _, x, _, _ in frames if "depth_step0" in x and '"subed"' not in x]
    print(f"subed acknowledgements {len(acks)}, book frames {len(book)}, closed {closed}")
    for b in book:
        t = b.get("tick") or {}
        kind = "full" if "asks" in t or "buys" in t else f"other keys {sorted(t)}"
        print(f"  {kind}: bids {len(t.get('buys') or [])} asks {len(t.get('asks') or [])}, cb_id {b.get('cb_id')!r}")


async def mode_client_ping():
    print("\n== mode client ping: send {'ping': ts} and wait 6 s")
    ws, _ = await connect()
    ts = int(time.time())
    await ws.send(json.dumps({"ping": ts}))
    frames, closed = await collect(ws, 6, answer_ping=False)
    await ws.close()
    for t, x, _, kind in frames:
        print(f"  +{t:.2f} s {kind} {trim(x)}")
    print(f"closed {closed}")


async def mode_compression():
    print("\n== mode compression: offer permessage-deflate")
    ws, open_ms = await connect(compression="deflate")
    print(f"open {open_ms:.0f} ms, sec-websocket-extensions answered {ws.response.headers.get('sec-websocket-extensions')!r}")
    await ws.close()


async def mode_silence():
    print("\n== mode silence: subscribe one book, never answer pings, up to 120 s")
    ws, _ = await connect()
    await ws.send(sub("market_btcusdt_depth_step0"))
    frames, closed = await collect(ws, 120, answer_ping=False)
    pings = [round(t, 1) for t, x, _, _ in frames if x.startswith('{"ping"')]
    print(f"frames {len(frames)}, server pings at s {pings}")
    print(f"closed {closed}, last frame at {frames[-1][0]:.1f} s" if frames else f"closed {closed}")
    if not closed:
        await ws.close()


async def main():
    for mode in (mode_book, mode_errors, mode_channels, mode_many, mode_doc_sub, mode_client_ping, mode_compression, mode_silence):
        await mode()
        await asyncio.sleep(1)


if __name__ == "__main__":
    asyncio.run(main())
