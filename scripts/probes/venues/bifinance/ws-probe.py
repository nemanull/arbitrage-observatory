# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""BiFinance futures WebSocket book probe for docs/profiles/bifinance/websocket.md.

Public, unauthenticated and read-only.
The socket is the web app's own feed, wss://www.bifinance.com/wsContract/zh_cn/, with the topic names
found in the public JS bundle. No API document describes it.
It holds sockets open for about 2.5 minutes of wall time, in this order:
  A. 40 s on BTCUSDT, ETHUSDT and CSCOUSDT trade depth, BTCUSDT paint depth and BTCUSDT mark price.
  B. 8 s of the all-contract ticker, unknown, malformed, spot and repeated subscriptions, and an unsubscribe.
  C. 30 s with every contract's trade depth on one socket.
  D. 75 s on two sockets at once, one that answers the server ping and one that never does.
Run from the repository root with: uv run scripts/probes/venues/bifinance/ws-probe.py [A|B|C|D]
"""

import asyncio
import collections
import hashlib
import json
import statistics
import sys
import time
import urllib.request
import zlib

import websockets

URL = "wss://www.bifinance.com/wsContract/zh_cn/"
API = "https://www.bifinance.com/api"
SIGN_KEY = "mnn#QyrnvLcBbGdX7" + "tWNZImfINb7cTL" + "r"  # the web app's request signing key, see rest-probe.py


def catalog() -> list[str]:
    now_ms = int(time.time() * 1000)
    sig = hashlib.md5(f"time={now_ms - 688}&key={SIGN_KEY}".encode()).hexdigest()
    req = urllib.request.Request(
        API + "/contract-market/get-all-contract-coinmarket", data=b"{}", method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 survey-probe", "time": str(now_ms), "deviceType": "3", "signature": sig},
    )
    with urllib.request.urlopen(req, timeout=20) as r:
        return [row["coinMarket"] for row in json.load(r)["data"]]


def depth(sym: str, kind: str = "trade") -> str:
    return f"alpha-market-depth-contract-{sym.lower()}-{kind}"


def decode(message) -> tuple[dict, str]:
    if isinstance(message, bytes):
        kind = "gzip" if message[:2] == b"\x1f\x8b" else "zlib" if message[:1] == b"\x78" else "binary"
        text = zlib.decompress(message, 47).decode()
    else:
        kind, text = "text", message
    try:
        return json.loads(text), kind
    except json.JSONDecodeError:
        return {"not_json": text[:200]}, kind


def trim(d: dict, n: int = 2) -> str:
    d = json.loads(json.dumps(d))
    body = d.get("data")
    if isinstance(body, dict):
        for side in ("bids", "asks"):
            if isinstance(body.get(side), list):
                total = len(body[side])
                body[side] = body[side][:n] + [f"... {total} levels"]
    return json.dumps(d)[:900]


async def connect():
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, compression=None, ping_interval=None, max_size=None, open_timeout=20, user_agent_header="Mozilla/5.0 survey-probe")
    return ws, (time.perf_counter() - t0) * 1000


async def sub(ws, topic: str, n: int, cmd: str = "sub") -> None:
    await ws.send(json.dumps({"id": f"probe{n}", "cmd": cmd, "topic": topic, "data": {}}))


async def collect(ws, seconds: float, answer_ping: bool = True, sink=None) -> list[tuple[float, dict | None, str, int]]:
    frames = []
    end = time.monotonic() + seconds
    while (left := end - time.monotonic()) > 0:
        try:
            message = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            break
        d, kind = decode(message)
        frames.append((time.monotonic(), d, kind, len(message)))
        if answer_ping and isinstance(d, dict) and "ping" in d:
            await ws.send(json.dumps({"pong": d["ping"]}))
        if sink:
            sink(d)
    return frames


def levels_ok(body: dict) -> tuple[bool, bool, bool]:
    bp = [float(x["trustPrice"]) for x in body.get("bids") or []]
    ap = [float(x["trustPrice"]) for x in body.get("asks") or []]
    return bp == sorted(bp, reverse=True), ap == sorted(ap), bool(bp and ap and bp[0] >= ap[0])


async def mode_a() -> None:
    print("== A. 40 s on three trade depths, one paint depth and one mark price")
    ws, ms = await connect()
    print(f"handshake {ms:.0f} ms, response headers: {dict(ws.response.headers)}")
    topics = [depth("BTCUSDT"), depth("ETHUSDT"), depth("CSCOUSDT"), depth("BTCUSDT", "paint"), "usdt-marked-price-btcusdt"]
    sent = time.monotonic()
    for n, t in enumerate(topics):
        await sub(ws, t, n)
    frames = await collect(ws, 40)
    await ws.close()
    kinds = collections.Counter(k for _, _, k, _ in frames)
    print("frame encodings:", dict(kinds))
    pings = [t for t, d, _, _ in frames if isinstance(d, dict) and "ping" in d]
    print(f"server pings: {len(pings)}, intervals {[round(b - a, 1) for a, b in zip(pings, pings[1:])]} s")
    acks = [d for _, d, _, _ in frames if isinstance(d, dict) and "topic" not in d and "ping" not in d]
    print("frames that are neither topic data nor ping (acks, errors):", acks[:5] or "none")
    by_topic = collections.defaultdict(list)
    for t, d, _, size in frames:
        if isinstance(d, dict) and d.get("topic"):
            by_topic[d["topic"]].append((t, d, size))
    for topic in topics:
        rows = by_topic.get(topic, [])
        if not rows:
            print(f"{topic}: no frames")
            continue
        gaps = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
        stamps = [r[1].get("time") for r in rows]
        bodies = [json.dumps(r[1]["data"], sort_keys=True) for r in rows]
        repeats = sum(1 for a, b in zip(bodies, bodies[1:]) if a == b)
        first = rows[0][0] - sent
        line = f"{topic}: {len(rows)} frames, first after {first * 1000:.0f} ms"
        if gaps:
            line += f", gap median {statistics.median(gaps) * 1000:.0f} ms, max {max(gaps) * 1000:.0f} ms"
        line += f", identical consecutive bodies {repeats}, time field monotonic {all(a <= b for a, b in zip(stamps, stamps[1:]))}"
        print(line)
        body = rows[-1][1]["data"]
        if "bids" in body:
            counts = collections.Counter((len(r[1]["data"].get("bids") or []), len(r[1]["data"].get("asks") or [])) for r in rows)
            orders = collections.Counter(levels_ok(r[1]["data"]) for r in rows)
            print(f"   level counts (bids, asks): {dict(counts)}, (bids desc, asks asc, crossed): {dict(orders)}")
            print(f"   keys: frame {sorted(rows[-1][1])}, data {sorted(body)}, level {sorted(body['bids'][0])}")
            sums = collections.Counter(r[1]["data"]["bids"][0].get("cumulativeTransactionVolume") for r in rows if r[1]["data"].get("bids"))
            print(f"   cumulativeTransactionVolume values on the top bid: {dict(sums)}")
            size_key = "cumulativeCommissionQuantity" if "cumulativeCommissionQuantity" in body["bids"][0] else "lastNumber"
            sizes = [lv[size_key] for r in rows for side in ("bids", "asks") for lv in r[1]["data"][side]]
            print(f"   {size_key}: {len(sizes)} levels, not whole numbers {sum(1 for x in sizes if float(x) != int(float(x)))}, decimals seen {sorted({len(x.split('.')[1]) if '.' in x else 0 for x in sizes})}")
        print("   last frame:", trim(rows[-1][1]))
        print(f"   frame sizes on the wire: median {statistics.median([r[2] for r in rows]):.0f} bytes")
    if pings:
        print("ping frame:", json.dumps(next(d for _, d, _, _ in frames if isinstance(d, dict) and "ping" in d)))


async def mode_b() -> None:
    print("== B. all-contract ticker, unknown, malformed, spot, repeated subscriptions and unsubscribe")
    ws, _ = await connect()
    await sub(ws, depth("NOPEUSDT"), 1)
    await sub(ws, "alpha-market-depth-contract-btc-usdt-trade", 2)
    await sub(ws, "alpha-market-depth-btc-usdt-trade", 3)  # the spot topic name, on the contract socket
    await sub(ws, depth("ETHUSDT"), 4)
    await sub(ws, depth("ETHUSDT"), 5)
    await sub(ws, "alpha-market-ticker-contract", 7)
    await ws.send("not json")
    await ws.send(json.dumps({"cmd": "sub", "topic": depth("SOLUSDT")}))  # no id and no data
    tickers, ticker_frame = set(), None
    frames = await collect(ws, 4)
    for t, d, kind, size in frames:
        if isinstance(d, dict) and d.get("cmd") == "deal" and "coinMarket" in (d.get("data") or {}):
            tickers.add(d["data"]["coinMarket"])
            ticker_frame = d
            continue
        if not (isinstance(d, dict) and d.get("topic") in (depth("ETHUSDT"), depth("SOLUSDT"))):
            print("  non-data frame:", kind, json.dumps(d)[:200] if d is not None else "not JSON")
    print(f"  alpha-market-ticker-contract: {len(tickers)} contracts in 4 s, frame keys {sorted(ticker_frame) if ticker_frame else None}, data keys {sorted(ticker_frame['data']) if ticker_frame else None}")
    counts = collections.Counter(d.get("topic") for _, d, _, _ in frames if isinstance(d, dict) and d.get("topic"))
    print("  data frames per topic in 4 s:", dict(counts))
    await sub(ws, depth("ETHUSDT"), 6, cmd="unsub")
    t_unsub = time.monotonic()
    frames = await collect(ws, 4)
    late = [t - t_unsub for t, d, _, _ in frames if isinstance(d, dict) and d.get("topic") == depth("ETHUSDT")]
    print(f"  ETHUSDT frames after unsub: {len(late)}, last at {max(late) * 1000 if late else 0:.0f} ms")
    await ws.close()


async def mode_c() -> None:
    syms = catalog()
    print(f"== C. 30 s with all {len(syms)} contracts' trade depth on one socket")
    ws, _ = await connect()
    for n, s in enumerate(syms):
        await sub(ws, depth(s), n)
    t0 = time.monotonic()
    frames = await collect(ws, 30)
    await ws.close()
    per = collections.defaultdict(list)
    for t, d, _, size in frames:
        if isinstance(d, dict) and d.get("topic", "").startswith("alpha-market-depth-contract-"):
            per[d["topic"]].append(t)
    silent = [s for s in syms if depth(s) not in per]
    max_gap = {}
    for topic, ts in per.items():
        edges = [t0] + ts + [t0 + 30]
        max_gap[topic] = max(b - a for a, b in zip(edges, edges[1:]))
    total = sum(len(v) for v in per.values())
    print(f"topics with frames {len(per)} of {len(syms)}, silent {silent or 'none'}, frames {total} ({total / 30:.0f} per s)")
    worst = sorted(max_gap.items(), key=lambda kv: -kv[1])[:5]
    print("largest silence per topic, including the window edges:", [(k.split('-')[-2], round(v, 1)) for k, v in worst])
    counts = sorted(len(v) for v in per.values())
    print(f"frames per topic in 30 s: min {counts[0]}, median {statistics.median(counts)}, max {counts[-1]}")


async def mode_d() -> None:
    print("== D. 75 s keepalive, one socket answers the server ping, one never does")
    async def run(answer: bool) -> str:
        ws, _ = await connect()
        await sub(ws, depth("BTCUSDT"), 1)
        t0 = time.monotonic()
        pings = []
        try:
            end = t0 + 75
            while (left := end - time.monotonic()) > 0:
                message = await asyncio.wait_for(ws.recv(), left)
                d, _ = decode(message)
                if isinstance(d, dict) and "ping" in d:
                    pings.append(round(time.monotonic() - t0, 1))
                    if answer:
                        await ws.send(json.dumps({"pong": d["ping"]}))
        except asyncio.TimeoutError:
            pass
        except websockets.ConnectionClosed as closed:
            return f"answer={answer}: closed after {time.monotonic() - t0:.1f} s, code {closed.rcvd.code if closed.rcvd else None} reason {closed.rcvd.reason if closed.rcvd else None!r}, pings at {pings}"
        await ws.close()
        return f"answer={answer}: still open at 75 s, pings at {pings}"
    for line in await asyncio.gather(run(True), run(False)):
        print(" ", line)


MODES = {"A": mode_a, "B": mode_b, "C": mode_c, "D": mode_d}

if __name__ == "__main__":
    chosen = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("probe run", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()))
    for name, fn in MODES.items():
        if chosen in (name, "all"):
            asyncio.run(fn())
