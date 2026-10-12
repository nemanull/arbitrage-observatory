# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of the CoinMy public sockets, the ChainUp web socket shape.

Modes: futures (40 s), history (10 s), spot (45 s), silence (75 s), compress (15 s), and all of them in turn by default, about three minutes of socket time.
Run from the repository root: uv run scripts/probes/venues/coinmy/ws-probe.py [mode]
Captures go to .claude/survey-work/coinmy/.
"""

import asyncio
import collections
import gzip
import json
import statistics
import sys
import time
import urllib.request
import zlib
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/coinmy")
FUT_URL = "wss://api.cmgatewayapi.com/futures/ws"  # wsUrl of the futures public_info
FUT_URL_WEB = "wss://ws.coinmy.com/futures"  # the URL hard coded in the web bundle, opened with ?compress=1 by the web app
SPOT_URL = "wss://api.cmgatewayapi.com/spot/ws"  # wsUrl of the spot public_info_v7
FUT_INFO = "https://api.cmgatewayapi.com/futures/api/common/public_info"
SPOT_INFO = "https://api.cmgatewayapi.com/spot/api/common/public_info_v7"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
SPOT_WATCH = ["btcusdt", "ethusdt", "solusdt", "cmusdt"]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%H:%M:%S")


def sub(channel: str, event: str = "sub", **extra) -> str:
    return json.dumps({"event": event, "params": {"channel": channel, "cb_id": "1", **extra}})


def decode(message) -> tuple[str, dict | None]:
    if isinstance(message, str):
        kind, text = "text", message
    elif message[:2] == b"\x1f\x8b":
        kind, text = "binary gzip", gzip.decompress(message).decode()
    else:
        try:  # a zlib stream ended by a sync flush, not a final block, so zlib.decompress would refuse it
            kind, text = "binary zlib", zlib.decompressobj().decompress(message).decode()
        except zlib.error:
            kind, text = "binary other", message.decode(errors="replace")
    try:
        return kind, json.loads(text)
    except ValueError:
        return kind, None


def post(url: str, cached: str) -> dict:
    req = urllib.request.Request(url, data=b"{}", headers={"User-Agent": UA, "Content-Type": "application/json", "exchange-client": "pc", "exchange-language": "en_US"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            body = json.loads(reply.read())
        if body.get("code") == "0":
            return body["data"]
        print(f"{url} answered code {body.get('code')} {body.get('msg')}, so the probe uses {cached} from the catalog run")
    except OSError as error:
        print(f"{url} failed ({error}), so the probe uses {cached} from the catalog run")
    return json.loads((WORK / cached).read_text())["data"]


async def connect(url: str):
    start = time.perf_counter()
    ws = await websockets.connect(url, compression=None, max_size=None, open_timeout=20, ping_interval=None, user_agent_header=UA)
    print(f"{now()} open {url} in {(time.perf_counter() - start) * 1000:.0f} ms, extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}")
    return ws


async def pump(ws, seconds: float, on_frame, answer_ping: bool = True) -> collections.Counter:
    kinds = collections.Counter()
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        try:
            message = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.monotonic()))
        except asyncio.TimeoutError:
            break
        kind, frame = decode(message)
        kinds[kind] += 1
        if frame is None:
            print(f"  undecodable {kind} frame {message[:80]!r}")
            continue
        if "ping" in frame:
            kinds["ping"] += 1
            if answer_ping:
                await ws.send(json.dumps({"pong": frame["ping"]}))
            continue
        on_frame(frame, len(message))
    return kinds


async def mode_futures() -> None:
    print(f"\n# futures, {now()}")
    contracts = post(FUT_INFO, "fut-public-info.json")["contractList"]
    ws = await connect(FUT_URL)
    frames = collections.Counter()
    last: dict[str, dict] = {}
    first: dict[str, str] = {}
    ticks: dict[str, list[float]] = collections.defaultdict(list)
    tick_keys: set[str] = set()
    sent = time.monotonic()
    for c in contracts:
        s = c["subSymbol"]
        for channel in (f"market_{s}", f"market_{s}_depth_{c['coinResultVo']['depthList'][0]}", f"market_{s}_deals"):
            await ws.send(sub(channel))
    extras = ["market_e_btcusdt_depth_step0", "market_e_btcusdt_depth_0", "market_e_btcusdt_depth_1", "market_e_btcusdt_depth_10", "market_e_ethusdt_depth_step0", "market_e_ethusdt_depth_2", "market_e_btcusdt_trade_ticker", "market_e_btcusdt_ticker", "market_e_nosuchusdt_depth_0.1"]
    for channel in extras:
        await ws.send(sub(channel))
    print(f"sent {3 * len(contracts) + len(extras)} subscribe frames: ticker, depth at the finest depthList step, and deals for each of {len(contracts)} contracts, plus {len(extras)} other spellings")

    def on_frame(frame, size):
        channel = frame.get("channel", "?")
        frames[channel] += 1
        last[channel] = frame
        if channel not in first:
            first[channel] = json.dumps(frame)[:600]
        if channel.count("_") == 2 and channel.startswith("market_e_"):  # market_e_<x>, the ticker
            ticks[channel].append(time.monotonic() - sent)
            tick_keys.update(frame.get("tick") or {})

    kinds = await pump(ws, 40, on_frame)
    await ws.close()
    depth = sum(1 for ch in frames if "_depth_" in ch)
    deals = sum(1 for ch in frames if ch.endswith("_deals"))
    tickers = sum(1 for ch in frames if ch.count("_") == 2)
    print(f"frame kinds {dict(kinds)}, streams with frames: ticker {tickers}, depth {depth}, deals {deals}")
    print("other spellings: " + ", ".join(f"{ch} {frames[ch]}" for ch in extras))
    gaps, zero_vol, rows = [], 0, []
    for c in contracts:
        t = last.get(f"market_{c['subSymbol']}", {}).get("tick")
        if not t:
            continue
        mark, index = float(t.get("sign_price") or 0), float(t.get("index_price") or 0)
        gap = round((mark / index - 1) * 1e6) if index else None
        zero_vol += float(t.get("vol") or 0) == 0
        if gap is not None:
            gaps.append(abs(gap))
        rows.append(f"  {c['contractName']:<20} close {t.get('close'):<12} vol {t.get('vol'):<4} mark {mark:<14.6f} index {index:<14.6f} gap {gap} ppm, funding last {t.get('funding_rate_last')} next {t.get('funding_rate_next')}, ticker frames {frames[f'market_' + c['subSymbol']]}")
    print(f"tickers seen {len(rows)} of {len(contracts)}, zero 24 h volume on {zero_vol}, abs mark to index gap median {statistics.median(gaps) if gaps else None} ppm, max {max(gaps) if gaps else None} ppm, at or under 1,000 ppm on {sum(g <= 1000 for g in gaps)}")
    print("\n".join(rows))
    btc = ticks.get("market_e_btcusdt", [])
    if len(btc) > 2:
        spacing = [b - a for a, b in zip(btc, btc[1:])]
        print(f"BTC ticker: {len(btc)} frames, spacing median {statistics.median(spacing):.2f} s, max {max(spacing):.2f} s")
    print(f"BTC ticker first frame: {first.get('market_e_btcusdt')}")
    print(f"ticker keys across every frame: {sorted(tick_keys)}")
    (WORK / "ws-futures-last.json").write_text(json.dumps(last, indent=1))


async def mode_history() -> None:
    print(f"\n# history, {now()}")
    ws = await connect(FUT_URL)
    for channel in ("market_e_btcusdt_kline_1day", "market_e_ethusdt_kline_1day"):
        await ws.send(sub(channel, event="req", endIdx="", pageSize=300))
    replies = {}

    def on_frame(frame, size):
        if frame.get("eventResp") == "req" and isinstance(frame.get("tick"), list):
            replies[frame.get("channel")] = frame

    await pump(ws, 10, on_frame)
    await ws.close()
    for channel, frame in replies.items():
        bars = sorted(frame["tick"], key=lambda b: b["id"])
        traded = [b for b in bars if float(b.get("vol") or 0) > 0]
        days = lambda b: datetime.fromtimestamp(b["id"], timezone.utc).date().isoformat()
        print(f"{channel}: {len(bars)} daily bars from {days(bars[0]) if bars else None} to {days(bars[-1]) if bars else None}, {len(traded)} with volume, last traded day {days(traded[-1]) if traded else None}, last close {bars[-1].get('close') if bars else None}")
    if not replies:
        print("no req reply in 10 s")


async def mode_spot() -> None:
    print(f"\n# spot, {now()}")
    pairs = {p["symbol"]: p for q in post(SPOT_INFO, "spot-public-info.json")["market"]["market"].values() for p in q.values()}
    ws = await connect(SPOT_URL)
    sent = {}
    channels = {}
    for s in SPOT_WATCH:
        step = pairs[s]["depth"].split(",")[0]
        channels[s] = f"market_{s}_depth_{step}"
        sent[channels[s]] = time.monotonic()
        await ws.send(sub(channels[s]))
    for extra in ("market_btcusdt_depth_step0", "market_nosuchusdt_depth_0.01", "market_btcusdt_depth_0.5", "market_btcusdt_ticker", "market_btcusdt"):
        await ws.send(sub(extra))
    stats = collections.defaultdict(lambda: {"n": 0, "t": [], "levels": [], "ordered": 0, "crossed": 0, "same": 0, "prev": None, "keys": set()})
    captured = {}

    def on_frame(frame, size):
        channel = frame.get("channel", "?")
        st = stats[channel]
        st["n"] += 1
        st["t"].append(time.monotonic())
        tick = frame.get("tick") or {}
        if channel not in captured:
            if "_depth_" in channel and isinstance(tick, dict):  # keep three levels a side for the profile
                trimmed = {**frame, "tick": {k: (v[:3] if isinstance(v, list) else v) for k, v in tick.items()}}
                captured[channel] = json.dumps(trimmed, separators=(",", ":"))
            else:
                captured[channel] = json.dumps(frame, separators=(",", ":"))[:700]
            if channel in sent:
                print(f"  first frame of {channel} {(time.monotonic() - sent[channel]) * 1000:.0f} ms after subscribe, eventResp {frame.get('eventResp')}, tick keys {sorted(tick)}")
        if "_depth_" in channel and isinstance(tick, dict):
            asks, bids = tick.get("asks") or [], tick.get("buys") or tick.get("bids") or []
            st["keys"].update(k for k in tick if k in ("asks", "buys", "bids"))
            st["levels"].append((len(asks), len(bids)))
            ap, bp = [float(a[0]) for a in asks], [float(b[0]) for b in bids]
            st["ordered"] += ap == sorted(ap) and bp == sorted(bp, reverse=True)
            st["crossed"] += bool(ap and bp and bp[0] >= ap[0])
            st["same"] += st["prev"] == (asks, bids)
            st["prev"] = (asks, bids)
            st["cum_ok"] = all(len(a) >= 3 for a in asks)

    kinds = await pump(ws, 45, on_frame)
    await ws.close()
    print(f"frame kinds {dict(kinds)}")
    for channel, st in stats.items():
        line = f"  {channel}: {st['n']} frames"
        if len(st["t"]) > 2:
            spacing = [b - a for a, b in zip(st["t"], st["t"][1:])]
            line += f", spacing median {statistics.median(spacing):.2f} s max {max(spacing):.2f} s"
        if st["levels"]:
            line += f", levels per side min {min(min(l) for l in st['levels'])} max {max(max(l) for l in st['levels'])}, side keys {sorted(st['keys'])}, ordered {st['ordered']}, crossed {st['crossed']}, identical to previous {st['same']}"
        print(line)
    for extra in ("market_btcusdt_depth_step0", "market_nosuchusdt_depth_0.01", "market_btcusdt_depth_0.5", "market_btcusdt_ticker"):
        print(f"  {extra}: {stats[extra]['n'] if extra in stats else 0} frames")
    print(f"captured BTC first frame: {captured.get(channels['btcusdt'])}")
    print(f"captured BTC ticker frame: {captured.get('market_btcusdt')}")
    (WORK / "ws-spot-captures.json").write_text(json.dumps(captured, indent=1))


async def mode_silence() -> None:
    print(f"\n# silence, {now()}")

    async def run(label: str, answer: bool, subscribe: bool):
        ws = await connect(SPOT_URL)
        if subscribe:
            await ws.send(sub("market_btcusdt_depth_0.01"))
        pings = []
        start = time.monotonic()
        try:
            while time.monotonic() - start < 75:
                message = await asyncio.wait_for(ws.recv(), timeout=max(0.1, 75 - (time.monotonic() - start)))
                kind, frame = decode(message)
                if frame and "ping" in frame:
                    pings.append(round(time.monotonic() - start, 1))
                    if answer:
                        await ws.send(json.dumps({"pong": frame["ping"]}))
            print(f"  {label}: open after 75 s, server pings at {pings}")
        except websockets.ConnectionClosed as closed:
            print(f"  {label}: closed {closed.rcvd.code if closed.rcvd else None} at {time.monotonic() - start:.1f} s, server pings at {pings}")
        except asyncio.TimeoutError:
            print(f"  {label}: open after 75 s, server pings at {pings}")
        await ws.close()

    await asyncio.gather(run("subscribed, answers pings", True, True), run("subscribed, never answers", False, True), run("unsubscribed, never answers", False, False))


async def mode_compress() -> None:
    print(f"\n# compress, {now()}")
    for url in (FUT_URL_WEB + "?compress=1", SPOT_URL + "?compress=1", FUT_URL_WEB):
        ws = await connect(url)
        await ws.send(sub("market_e_btcusdt" if "futures" in url else "market_btcusdt_depth_0.01"))
        kinds = await pump(ws, 5, lambda frame, size: None)
        await ws.close()
        print(f"  {url}: frame kinds {dict(kinds)}")


MODES = {"futures": mode_futures, "history": mode_history, "spot": mode_spot, "silence": mode_silence, "compress": mode_compress}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if chosen in (name, "all"):
            asyncio.run(fn())
