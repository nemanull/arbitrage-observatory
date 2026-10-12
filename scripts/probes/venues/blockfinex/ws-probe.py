# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=14"]
# ///
"""Read-only WebSocket probe for the Blockfinex futures socket, a ChainUp kline-api socket.

Public, unauthenticated, read-only.
Sockets open without permessage-deflate and without protocol pings, like the engine's book feeds, except in mode deflate.

Modes, each printing one JSON line per finding:
    book      depth_step0 on four perpetuals, the ticker, trade and mark_price channels, an unknown symbol, step1, 20 s, then the REST book for comparison.
    batch     depth_step0 and mark_price on every trading USDT perpetual on one socket for 20 s.
    silence   one socket that never answers the server ping and one that does, up to 40 s each, side by side.
    deflate   asks for permessage-deflate once and prints what the server negotiates.
    mark      one socket with only a depth channel and one with only a mark_price channel, 6 s each, to see what pushes mark frames.
    marks     four sockets in turn, each subscribing depth and mark_price for every trading USDT perpetual as the engine would, 5 s each,
              counting the mark frames that arrive after the first 2 s, since some sockets stop sending marks after the subscribe snapshot.
    spot      the spot host ws.blockfinex.com with a futures and a spot channel, 8 s.
    all       every mode above in turn, about 130 s of sockets.

Run from the repository root:
    uv run scripts/probes/venues/blockfinex/ws-probe.py [book|batch|silence|deflate|spot|all]

Set PROBE_OUT_DIR to keep raw decoded frames, for example .claude/survey-work/blockfinex/frames.
Recorded in docs/profiles/blockfinex/websocket.md.
"""

import asyncio
import gzip
import json
import os
import statistics
import sys
import time
import urllib.request

import websockets
from websockets.exceptions import InvalidStatus

FUT_WS = "wss://futuresws.blockfinex.com/kline-api/ws"
SPOT_WS = "wss://ws.blockfinex.com/kline-api/ws"
API = "https://futuresopenapi.blockfinex.com/fapi/v1"
OUT = os.environ.get("PROBE_OUT_DIR")


def log(tag: str, **fields) -> None:
    print(json.dumps({"tag": tag, "at": round(time.time(), 3), **fields}, default=str), flush=True)


def capture(name: str, text: str) -> None:
    if not OUT:
        return
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, name), "a") as f:
        f.write(f"{int(time.time() * 1000)} {text[:4000]}\n")


def get_json(url: str):
    req = urllib.request.Request(url, headers={"User-Agent": "observatory-probe"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())


def socket_name(contract: str) -> str:
    # E-BTC-USDT to e_btcusdt: lower case, the first hyphen an underscore and the others gone.
    kind, _, rest = contract.lower().partition("-")
    return f"{kind}_{rest.replace('-', '')}"


def sub(channel: str, cb_id: str = "1") -> str:
    return json.dumps({"event": "sub", "params": {"channel": channel, "cb_id": cb_id}})


def decode(data) -> tuple[bool, str]:
    if isinstance(data, bytes):
        if data[:2] == b"\x1f\x8b":
            return True, gzip.decompress(data).decode()
        return False, data.decode(errors="replace")
    return False, data


async def connect(url: str, deflate: bool = False):
    t0 = time.perf_counter()
    try:
        ws = await websockets.connect(
            url,
            compression="deflate" if deflate else None,
            ping_interval=None,
            open_timeout=10,
            close_timeout=2,
            max_size=2**24,
        )
    except InvalidStatus as e:
        body = e.response.body.decode(errors="replace")[:300] if e.response.body else ""
        log("refused", url=url, status=e.response.status_code, body=body)
        return None
    except Exception as e:  # noqa: BLE001
        log("error", url=url, msg=repr(e))
        return None
    log(
        "open",
        url=url,
        ms=round((time.perf_counter() - t0) * 1000, 1),
        extensions=ws.response.headers.get("Sec-WebSocket-Extensions"),
        server=ws.response.headers.get("Server"),
    )
    return ws


def ordered(prices: list[float], ascending: bool) -> bool:
    return all((b > a) if ascending else (b < a) for a, b in zip(prices, prices[1:]))


async def book() -> None:
    contracts = ["E-BTC-USDT", "E-ETH-USDT", "E-ENJ-USDT", "E-XAU-USDT", "E-BTC-USD"]
    ws = await connect(FUT_WS)
    if not ws:
        return
    t0 = time.monotonic()
    stats: dict[str, dict] = {}
    gz = plain = pings = 0
    ping_times: list[float] = []
    others: list[str] = []

    async def reader():
        nonlocal gz, plain, pings
        async for data in ws:
            was_gz, text = decode(data)
            gz += was_gz
            plain += not was_gz
            capture("book.jsonl", text)
            try:
                m = json.loads(text)
            except json.JSONDecodeError:
                others.append(text[:200])
                continue
            if "ping" in m:
                pings += 1
                ping_times.append(time.monotonic() - t0)
                if pings == 1:
                    log("ping_frame", frame=text, binary_gzip=was_gz)
                await ws.send(json.dumps({"pong": m["ping"]}))
                continue
            ch = m.get("channel") or f"no channel: {','.join(sorted(m))}"
            s = stats.setdefault(ch, {"n": 0, "first_s": None, "asks": [], "bids": [], "asc": 0, "desc": 0, "arrive_minus_ts": [], "sample": None, "last": None, "repeats": 0, "prev": None})
            s["n"] += 1
            now = time.time()
            if s["first_s"] is None:
                s["first_s"] = round(time.monotonic() - t0, 3)
                s["sample"] = text[:400]
            if isinstance(m.get("ts"), (int, float)):
                s["arrive_minus_ts"].append(now * 1000 - m["ts"])
            tick = m.get("tick") or {}
            if "asks" in tick or "buys" in tick:
                a = [float(l[0]) for l in tick.get("asks") or []]
                b = [float(l[0]) for l in tick.get("buys") or []]
                s["asks"].append(len(a))
                s["bids"].append(len(b))
                s["asc"] += ordered(a, True)
                s["desc"] += ordered(b, False)
                body = json.dumps(tick, sort_keys=True)
                s["repeats"] += body == s["prev"]
                s["prev"] = body
                s["last"] = tick
                s["keys"] = f"{','.join(sorted(m))} tick:{','.join(sorted(tick))}"
            elif s["n"] == 1:
                s["keys"] = f"{','.join(sorted(m))} tick:{','.join(sorted(tick)) if isinstance(tick, dict) else type(tick).__name__}"

    task = asyncio.create_task(reader())
    for c in contracts:
        await ws.send(sub(f"market_{socket_name(c)}_depth_step0", socket_name(c)))
    await ws.send(sub("market_e_btcusdt_ticker"))
    await ws.send(sub("market_e_btcusdt_trade_ticker"))
    await ws.send(sub("mark_price_e_btcusdt"))
    await ws.send(sub("market_e_btcusdt_depth_step1"))
    await ws.send(sub("market_e_nopeusdt_depth_step0"))
    await ws.send(sub("market_btcusdt_depth_step0"))
    await ws.send(sub("market_E-BTC-USDT_depth_step0"))
    await ws.send(json.dumps({"event": "nope", "params": {"channel": "market_e_btcusdt_ticker"}}))
    await asyncio.sleep(20)
    rest = None
    btc = stats.get("market_e_btcusdt_depth_step0")
    if btc and btc["last"]:
        r = get_json(f"{API}/depth?contractName=E-BTC-USDT&limit=30")
        last = btc["last"]
        rest = {"ws_bid": last["buys"][:3], "rest_bid": r["bids"][:3], "ws_ask": last["asks"][:3], "rest_ask": r["asks"][:3]}
    task.cancel()
    await ws.close()
    summary = {}
    for ch, s in stats.items():
        lag = s["arrive_minus_ts"]
        summary[ch] = {
            "n": s["n"],
            "first_s": s["first_s"],
            "keys": s.get("keys"),
            "ask_levels": [min(s["asks"]), max(s["asks"])] if s["asks"] else None,
            "bid_levels": [min(s["bids"]), max(s["bids"])] if s["bids"] else None,
            "asks_ascending": s["asc"],
            "bids_descending": s["desc"],
            "identical_repeats": s["repeats"],
            "arrival_minus_ts_ms": [round(min(lag)), round(statistics.median(lag)), round(max(lag))] if lag else None,
            "sample": s["sample"] if not s["asks"] else None,
        }
    gaps = [round(b - a, 2) for a, b in zip(ping_times, ping_times[1:])]
    log("book", url=FUT_WS, gzip_frames=gz, other_frames=plain, pings=pings, ping_gaps_s=gaps, non_json=others[:3], channels=summary, rest_compare=rest)


async def batch() -> None:
    rows = get_json(f"{API}/contracts")
    act = [r for r in rows if r["status"] == 1 and r["type"] == "E" and r["side"] == 1 and r["symbol"].endswith("-USDT")]
    ws = await connect(FUT_WS)
    if not ws:
        return
    t0 = time.monotonic()
    first: dict[str, float] = {}
    count: dict[str, int] = {}
    frames = pings = late_marks = 0
    ping_at: list[float] = []
    gaps: dict[str, list[float]] = {}
    last_at: dict[str, float] = {}

    async def reader():
        nonlocal frames, pings, late_marks
        async for data in ws:
            m = json.loads(decode(data)[1])
            if "ping" in m:
                pings += 1
                ping_at.append(round(time.monotonic() - t0, 1))
                await ws.send(json.dumps({"pong": m["ping"]}))
                continue
            frames += 1
            ch = m.get("channel")
            if not ch:
                continue
            now = time.monotonic() - t0
            late_marks += ch.startswith("mark_price_") and now > 2
            first.setdefault(ch, now)
            count[ch] = count.get(ch, 0) + 1
            if ch in last_at:
                gaps.setdefault(ch, []).append(now - last_at[ch])
            last_at[ch] = now

    task = asyncio.create_task(reader())
    for r in act:
        name = socket_name(r["symbol"])
        await ws.send(sub(f"market_{name}_depth_step0", name))
        await ws.send(sub(f"mark_price_{name}", name))
    sent_s = time.monotonic() - t0
    await asyncio.sleep(20)
    task.cancel()
    await ws.close()
    books = [f"market_{socket_name(r['symbol'])}_depth_step0" for r in act]
    marks = [f"mark_price_{socket_name(r['symbol'])}" for r in act]
    got_b = [c for c in books if c in first]
    got_m = [c for c in marks if c in first]
    nb = sorted(count[c] for c in got_b)
    nm = sorted(count[c] for c in got_m)
    btc_gaps = gaps.get("market_e_btcusdt_depth_step0", [])
    mark_gaps = gaps.get("mark_price_e_btcusdt", [])
    log(
        "batch",
        contracts=len(act),
        subscribe_frames=2 * len(act),
        sent_in_s=round(sent_s, 3),
        books_delivered=len(got_b),
        books_silent=[c for c in books if c not in first],
        marks_delivered=len(got_m),
        marks_silent=[c for c in marks if c not in first][:20],
        frames=frames,
        pings=pings,
        ping_at_s=ping_at,
        mark_frames_after_2s=late_marks,
        last_first_book_s=round(max(first[c] for c in got_b), 3) if got_b else None,
        book_frames_per_stream=[nb[0], nb[len(nb) // 2], nb[-1]] if nb else None,
        mark_frames_per_stream=[nm[0], nm[len(nm) // 2], nm[-1]] if nm else None,
        btc_book_gap_ms=[round(min(btc_gaps) * 1000), round(statistics.median(btc_gaps) * 1000), round(max(btc_gaps) * 1000)] if btc_gaps else None,
        btc_mark_gap_ms=[round(min(mark_gaps) * 1000), round(statistics.median(mark_gaps) * 1000), round(max(mark_gaps) * 1000)] if mark_gaps else None,
    )


async def silent_run(name: str, answer: bool) -> None:
    ws = await connect(FUT_WS)
    if not ws:
        return
    t0 = time.monotonic()
    pings = 0
    last = 0.0
    result = "open at 40 s"
    await ws.send(sub("market_e_enjusdt_depth_step0"))

    async def reader():
        nonlocal pings, last
        async for data in ws:
            m = json.loads(decode(data)[1])
            last = time.monotonic() - t0
            if "ping" in m:
                pings += 1
                if pings <= 2:
                    log("ping", run=name, at_s=round(last, 2), ping=m["ping"])
                if answer:
                    await ws.send(json.dumps({"pong": m["ping"]}))

    try:
        await asyncio.wait_for(reader(), timeout=40)
        result = {"code": ws.close_code, "reason": ws.close_reason, "at_s": round(time.monotonic() - t0, 2)}
    except asyncio.TimeoutError:
        pass
    except websockets.ConnectionClosed as e:
        result = {"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None, "at_s": round(time.monotonic() - t0, 2)}
    log("silence", run=name, pings=pings, last_frame_s=round(last, 2), close=result)
    await ws.close()


async def silence() -> None:
    await asyncio.gather(silent_run("no_pong", False), silent_run("pong", True))


async def deflate() -> None:
    ws = await connect(FUT_WS, deflate=True)
    if ws:
        await ws.close()


async def mark_only(name: str, channel: str) -> None:
    ws = await connect(FUT_WS)
    if not ws:
        return
    counts: dict[str, int] = {}

    async def reader():
        async for data in ws:
            m = json.loads(decode(data)[1])
            if "ping" in m:
                await ws.send(json.dumps({"pong": m["ping"]}))
                continue
            ch = m.get("channel") or ",".join(sorted(m))
            counts[ch] = counts.get(ch, 0) + 1

    task = asyncio.create_task(reader())
    await ws.send(sub(channel))
    await asyncio.sleep(6)
    task.cancel()
    await ws.close()
    log("mark", run=name, subscribed=channel, channels=counts)


async def mark() -> None:
    await mark_only("depth_only", "market_e_ethusdt_depth_step0")
    await mark_only("mark_only", "mark_price_e_btcusdt")


async def marks() -> None:
    rows = get_json(f"{API}/contracts")
    names = [socket_name(r["symbol"]) for r in rows if r["status"] == 1 and r["type"] == "E" and r["side"] == 1 and r["symbol"].endswith("-USDT")]
    for i in range(4):
        ws = await connect(FUT_WS)
        if not ws:
            continue
        peer = ws.transport.get_extra_info("peername")
        t0 = time.monotonic()
        per: dict[str, int] = {}
        late = 0

        async def reader():
            nonlocal late
            async for data in ws:
                m = json.loads(decode(data)[1])
                if "ping" in m:
                    await ws.send(json.dumps({"pong": m["ping"]}))
                    continue
                ch = m.get("channel") or ""
                if ch.startswith("mark_price_"):
                    per[ch] = per.get(ch, 0) + 1
                    late += time.monotonic() - t0 > 2

        task = asyncio.create_task(reader())
        for name in names:
            await ws.send(sub(f"market_{name}_depth_step0", name))
            await ws.send(sub(f"mark_price_{name}", name))
        await asyncio.sleep(5)
        task.cancel()
        await ws.close()
        counts = sorted(per.values())
        log("marks", socket=i, peer=peer[0] if peer else None, contracts=len(names), mark_streams=len(per), frames_per_stream=[counts[0], counts[len(counts) // 2], counts[-1]] if counts else None, mark_frames_after_2s=late)


async def spot() -> None:
    ws = await connect(SPOT_WS)
    if not ws:
        return
    seen: dict[str, str] = {}

    async def reader():
        async for data in ws:
            was_gz, text = decode(data)
            m = json.loads(text)
            if "ping" in m:
                await ws.send(json.dumps({"pong": m["ping"]}))
                continue
            ch = m.get("channel") or ",".join(sorted(m))
            seen.setdefault(ch, f"gzip={was_gz} {text[:200]}")

    task = asyncio.create_task(reader())
    await ws.send(sub("market_e_btcusdt_depth_step0"))
    await ws.send(sub("market_btcusdt_depth_step0"))
    await asyncio.sleep(8)
    task.cancel()
    await ws.close()
    log("spot", url=SPOT_WS, channels=seen)


async def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "book"
    modes = {"book": book, "batch": batch, "silence": silence, "deflate": deflate, "mark": mark, "marks": marks, "spot": spot}
    if mode == "all":
        for fn in modes.values():
            await fn()
    else:
        await modes[mode]()


asyncio.run(main())
