# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets==15.0.1"]
# ///
"""IBIT Global WebSocket probe.

Records what each socket host named in the web app's bundle answers to a client that does not carry the web app's sign.
Public, unauthenticated and read-only.
The web app appends ts and sign query parameters, and the market hosts also get env=local.
This probe never computes the sign.
Handshake modes, each held at most 8 s: plain sends no query, ts sends ts and env, empty adds an empty sign, env sends only env=local, and tsonly sends only ts.
On the two market hosts they send the subscribe frame the web app sends, with the BTCUSDT book channel, then the web app's ping.
Mode book holds one futures market socket for 60 s and measures the book, mark, index and funding channels.
Mode spot holds one spot market socket for 30 s and measures its book.
Mode mirror reads three futures BTCUSDT book frames and the public REST books of Binance, OKX and Bybit beside each, to see whether the ladder is copied.
Sockets open without permessage-deflate, like the engine does.

Run: uv run scripts/probes/venues/ibit-global/ws-probe.py [handshake|plain|ts|empty|env|tsonly|book|spot|mirror|all]
Set PROBE_OUT_DIR to keep raw frames. Recorded in docs/profiles/ibit-global/websocket.md.
"""

import asyncio
import collections
import json
import os
import statistics
import sys
import time
import urllib.request
import zlib

from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

HOSTS = [
    ("futures-market", "wss://prod-ibit-market-server-p-co-p-group.aka-line-a.com/ws/quotation",
     ["gzip_market_all_mark_price", "gzip_market_all_index_price", "gzip_market_BTCUSDT_depth_step0"], True),
    ("spot-market", "wss://prod-ibit-spot-market-server-p-co-p-group.aka-line-a.com/ws/quotation",
     ["market_all_latest_price", "market_BTCUSDT_depth_step0"], True),
    ("futures-private", "wss://prod-ibit-futures-ws-p-group.aka-line-a.com/ws/futures", None, False),
    ("spot-private", "wss://prod-ibit-spot-ws-p-group.aka-line-a.com/ws/spot", None, False),
    ("msghub", "wss://prod-ibit-msghub-p-wsserver-pc.aka-line-a.com/ws", None, False),
]
HOLD_S = 8
CMC_PERPS = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=ibit-global&category=perpetual&start=1&limit=200"
OUT = os.environ.get("PROBE_OUT_DIR")


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, ensure_ascii=False), flush=True)


def capture(name, text):
    if not OUT:
        return
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, f"{name}.txt"), "a") as f:
        f.write(text[:4000] + "\n")


def decode(data):
    if isinstance(data, str):
        return data
    for wbits in (31, 15, -15):
        try:
            return zlib.decompress(data, wbits).decode("utf-8", "replace")
        except zlib.error:
            pass
    return f"<binary {len(data)} bytes>"


def url_for(base, mode, market):
    ts = str(int(time.time() * 1000))
    env = "&env=local" if market else ""
    if mode == "plain":
        return base
    if mode == "ts":
        return f"{base}?ts={ts}{env}"
    if mode == "env":
        return f"{base}?env=local"
    if mode == "tsonly":
        return f"{base}?ts={ts}"
    return f"{base}?ts={ts}&sign={env}"


async def probe(name, base, channels, market, mode):
    url = url_for(base, mode, market)
    label = f"{name}-{mode}"
    t0 = time.perf_counter()
    ms = lambda: round((time.perf_counter() - t0) * 1000)
    try:
        async with connect(url, compression=None, open_timeout=HOLD_S, ping_interval=None, max_size=2**22) as ws:
            ext = ws.response.headers.get("Sec-WebSocket-Extensions")
            log("open", name=label, url=url, ms=ms(), extensions=ext)
            if channels:
                await ws.send(json.dumps({"event": "sub", "params": {"channels": channels}}))
            await ws.send(json.dumps({"event": "ping"}))
            frames = 0
            deadline = time.perf_counter() + HOLD_S
            while (left := deadline - time.perf_counter()) > 0:
                try:
                    data = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                frames += 1
                text = decode(data)
                capture(label, text)
                if frames <= 3:
                    gzip = isinstance(data, bytes) and data[:2] == b"\x1f\x8b"
                    log("frame", name=label, binary=not isinstance(data, str), gzip=gzip, bytes=len(data), head=text[:300])
            log("end", name=label, why="held", frames=frames, ms=ms())
    except InvalidStatus as e:
        body = (e.response.body or b"").decode("utf-8", "replace")
        capture(label + "-refusal", body)
        log("refused", name=label, url=url, status=e.response.status_code, ms=ms(), body=body[:200])
    except ConnectionClosed as e:
        rcvd = e.rcvd
        log("close", name=label, code=rcvd.code if rcvd else None, reason=rcvd.reason if rcvd else None, ms=ms())
    except Exception as e:  # noqa: BLE001, a probe records every failure shape
        log("error", name=label, kind=type(e).__name__, message=str(e)[:200], ms=ms())


FUTURES = HOSTS[0][1] + "?env=local"
SPOT = HOSTS[1][1] + "?env=local"


async def collect(url, channels, hold_s, label):
    """Subscribes, then records every frame as (arrival, decoded JSON) without sending a ping."""
    frames = []
    t0 = time.perf_counter()
    async with connect(url, compression=None, open_timeout=HOLD_S, ping_interval=None, max_size=2**23) as ws:
        await ws.send(json.dumps({"event": "sub", "params": {"channels": channels}}))
        deadline = t0 + hold_s
        try:
            while (left := deadline - time.perf_counter()) > 0:
                try:
                    data = await asyncio.wait_for(ws.recv(), timeout=left)
                except asyncio.TimeoutError:
                    break
                text = decode(data)
                capture(label, text)
                frames.append((time.perf_counter() - t0, not isinstance(data, str), json.loads(text)))
            log("held", name=label, seconds=round(time.perf_counter() - t0, 1), frames=len(frames), closed=False)
        except ConnectionClosed as e:
            log("held", name=label, seconds=round(time.perf_counter() - t0, 1), frames=len(frames), closed=True, code=e.rcvd.code if e.rcvd else None)
    return frames


def book_stats(label, frames, channel):
    rows = [(t, b, f) for t, b, f in frames if f.get("channel") == channel]
    if not rows:
        log("book", name=label, channel=channel, frames=0)
        return
    gaps = [round((b[0] - a[0]) * 1000) for a, b in zip(rows, rows[1:])]
    bids = [len(f["tick"].get("buys") or []) for _, _, f in rows]
    asks = [len(f["tick"].get("asks") or []) for _, _, f in rows]
    first = rows[0][2]
    b0, a0 = first["tick"]["buys"], first["tick"]["asks"]
    sizes = [q for _, _, f in rows for side in ("buys", "asks") for _, q in f["tick"].get(side) or []]
    repeats = sum(1 for a, b in zip(rows, rows[1:]) if a[2]["tick"] == b[2]["tick"])
    log(
        "book",
        name=label,
        channel=channel,
        frames=len(rows),
        binary=rows[0][1],
        frameKeys=sorted(first.keys()),
        tickKeys=sorted(first["tick"].keys()),
        bidLevels=[min(bids), max(bids)],
        askLevels=[min(asks), max(asks)],
        bidsDescending=all(x[0] > y[0] for x, y in zip(b0, b0[1:])),
        asksAscending=all(x[0] < y[0] for x, y in zip(a0, a0[1:])),
        crossed=sum(1 for _, _, f in rows if f["tick"]["buys"] and f["tick"]["asks"] and f["tick"]["buys"][0][0] >= min(p for p, _ in f["tick"]["asks"])),
        gapMs={"median": statistics.median(gaps) if gaps else None, "min": min(gaps, default=None), "max": max(gaps, default=None)},
        identicalRepeats=repeats,
        sizesMultipleOf0012=sum(1 for q in sizes if abs(round(q / 0.012) * 0.012 - q) < 1e-9),
        sizes=len(sizes),
        bidSpan=[b0[0][0], b0[-1][0]] if b0 else None,
        askSpan=[a0[-1][0], a0[0][0]] if a0 else None,
        sample={"bid": b0[:2], "ask": a0[:2], "ts": first.get("ts")},
    )


def all_stats(label, frames, channel):
    rows = [f for _, _, f in frames if f.get("channel") == channel]
    if not rows:
        log("all", name=label, channel=channel, frames=0)
        return
    keys = set(rows[-1]["tick"].keys())
    changed = collections.Counter()
    for a, b in zip(rows, rows[1:]):
        for k in keys:
            if a["tick"].get(k) != b["tick"].get(k):
                changed[k] += 1
    times = [t for t, _, f in frames if f.get("channel") == channel]
    gaps = [round((b - a) * 1000) for a, b in zip(times, times[1:])]
    out = {"name": label, "channel": channel, "frames": len(rows), "symbols": len(keys), "medianGapMs": statistics.median(gaps) if gaps else None,
           "symbolsThatChanged": len(changed), "frameKeys": sorted(rows[-1].keys()), "btcusdt": rows[-1]["tick"].get("btcusdt")}
    if channel.endswith("position_fee_rate"):
        rates = collections.Counter(v.get("positionFeeRate") for v in rows[-1]["tick"].values())
        upd = sorted({v.get("updateTime") // 1000 * 1000 for v in rows[-1]["tick"].values()})
        out.update(rates={str(k): v for k, v in rates.most_common()}, updateTimeSeconds=[upd[0], upd[-1]])
    log("all", **out)


async def book():
    channels = ["gzip_market_BTCUSDT_depth_step0", "gzip_market_ethusdt_depth_step0", "gzip_market_NOSUCHUSDT_depth_step0",
                "gzip_market_all_mark_price", "gzip_market_all_index_price", "gzip_market_all_position_fee_rate",
                "gzip_market_position_fee_rate_btcusdt", "gzip_market_depth_one_price_btcusdt",
                "gzip_market_btcusdt_ticker", "gzip_market_btcusdt_trade_ticker"]
    frames = await collect(FUTURES, channels, 60, "book")
    seen = collections.Counter(f.get("channel") or f.get("event") or f.get("topic") for _, _, f in frames)
    log("channels", name="book", counts=dict(seen))
    for ch in ["market_btcusdt_depth_step0", "market_ethusdt_depth_step0"]:
        book_stats("book", frames, ch)
    for ch in ["market_all_mark_price", "market_all_index_price", "market_all_position_fee_rate"]:
        all_stats("book", frames, ch)
    for ch in ["market_position_fee_rate_btcusdt", "market_depth_one_price_btcusdt", "market_btcusdt_ticker", "market_btcusdt_trade_ticker"]:
        hit = next((f for _, _, f in frames if f.get("channel") == ch), None)
        log("sample", channel=ch, frame=json.dumps(hit)[:600] if hit else None)
    tick = next((f["tick"] for _, _, f in reversed(frames) if f.get("channel") == "market_btcusdt_ticker"), None)
    if tick:
        vol = tick["vol"]
        log("ticker", vol=vol, volMultipleOf0012=abs(round(vol / 0.012) * 0.012 - vol) < 1e-6, amountOverClose=round(tick["amount"] / tick["close"], 1))
    marks = [f["tick"] for _, _, f in frames if f.get("channel") == "market_all_mark_price"]
    index = next((f["tick"] for _, _, f in reversed(frames) if f.get("channel") == "market_all_index_price"), {})
    funding = next((f["tick"] for _, _, f in reversed(frames) if f.get("channel") == "market_all_position_fee_rate"), {})
    symbols = set(marks[-1]) if marks else set()
    frozen = sorted(k for k in symbols if len({m.get(k) for m in marks}) == 1)
    status, text_ = 0, "{}"
    try:
        req = urllib.request.Request(CMC_PERPS, headers={"User-Agent": "curl/8.14.1"})
        with urllib.request.urlopen(req, timeout=20) as res:
            status, text_ = res.status, res.read().decode()
    except Exception as e:  # noqa: BLE001
        log("error", name="cmc", message=str(e)[:200])
    cmc = {p["marketPair"].replace("/", "").lower() for p in json.loads(text_).get("data", {}).get("marketPairs", [])}
    log(
        "catalog",
        source="market_all_mark_price",
        symbols=len(symbols),
        markUnchanged60s=frozen,
        markEqualsIndex=sum(1 for k in symbols if marks[-1][k] == index.get(k)),
        fundingOnly=sorted(set(funding) - symbols),
        cmcStatus=status,
        cmcPerpetuals=len(cmc),
        socketNotOnCmc=sorted(symbols - cmc),
        cmcNotOnSocket=sorted(cmc - symbols),
    )


async def spot():
    frames = await collect(SPOT, ["market_BTCUSDT_depth_step0", "market_all_latest_price"], 30, "spot")
    seen = collections.Counter(f.get("channel") or f.get("event") or f.get("topic") for _, _, f in frames)
    log("channels", name="spot", counts=dict(seen))
    book_stats("spot", frames, "market_btcusdt_depth_step0")
    all_stats("spot", frames, "market_all_latest_price")


def rest_book(url):
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8.14.1"})
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.load(res)


async def mirror():
    sources = {
        "binance": ("https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=50", lambda j: j["bids"]),
        "okx": ("https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=50", lambda j: j["data"][0]["bids"]),
        "bybit": ("https://api.bybit.com/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=50", lambda j: j["result"]["b"]),
    }
    async with connect(FUTURES, compression=None, open_timeout=HOLD_S, ping_interval=None, max_size=2**23) as ws:
        await ws.send(json.dumps({"event": "sub", "params": {"channels": ["gzip_market_BTCUSDT_depth_step0"]}}))
        for i in range(3):
            frame = None
            while frame is None:
                j = json.loads(decode(await ws.recv()))
                frame = j if j.get("channel") == "market_btcusdt_depth_step0" else None
            ours = {float(p) for p, _ in frame["tick"]["buys"][:20]}
            found = {}
            for name, (url, bids) in sources.items():
                try:
                    theirs = {float(row[0]) for row in bids(rest_book(url))}
                    found[name] = len(ours & theirs)
                except Exception as e:  # noqa: BLE001
                    found[name] = f"{type(e).__name__}: {str(e)[:80]}"
            log("mirror", round=i, ibitTopBid=frame["tick"]["buys"][0], top20BidPricesAlsoIn=found)
            await asyncio.sleep(2)


async def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    handshake = ["plain", "ts", "empty", "env", "tsonly"]
    modes = handshake if which in ("all", "handshake") else [which] if which in handshake else []
    for name, base, channels, market in HOSTS:
        for mode in modes:
            if mode in ("env", "tsonly") and not market:
                continue
            await probe(name, base, channels, market, mode)
    if which in ("all", "book"):
        await book()
    if which in ("all", "spot"):
        await spot()
    if which in ("all", "mirror"):
        await mirror()


if __name__ == "__main__":
    asyncio.run(main())
