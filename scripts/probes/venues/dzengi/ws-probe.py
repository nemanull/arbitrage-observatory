# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Dzengi public WebSocket probe, read-only and unauthenticated.

Dzengi documents one socket, wss://api-adapter.dzengi.com/connect, at https://dzengi.com/general-websocket-api-information.
Requests are JSON frames {"destination", "correlationId", "payload"}, and the subscriptions are listed in the Swagger group public-api at https://apitradedoc.dzengi.com/v2/api-docs?group=public-api.

Modes, run one after another, about four minutes of socket time in total, under three with --short:
  1. book: depthMarketData.subscribe and marketData.subscribe on spot and leverage symbols for 90 s (30 s with --short), with a ping every 15 s.
  2. errors: an unknown symbol, an unknown destination and a malformed frame.
  3. wide: one subscribe frame naming every TRADING spot crypto symbol, held 30 s.
  4. leverage: the leverage symbols alone on depth and quote subscriptions for 30 s.
  5. silence: no ping at all, on one subscribed socket and one silent socket at once, to see when the server closes them (documented at 30 s), capped at 75 s.

Run from the repository root: uv run scripts/probes/venues/dzengi/ws-probe.py
Pass --short for the second pass, which holds the book mode 30 s instead of 90 s and keeps every other mode.
"""

import asyncio
import collections
import sys
import json
import pathlib
import time
import urllib.request

import websockets

URL = "wss://api-adapter.dzengi.com/connect"
ALT_URL = "wss://api-adapter.backend.dzengi.com/connect"  # the host in the docs' code sample
REST = "https://api-adapter.dzengi.com/api/v2"
WORK = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "dzengi"
UA = "arbitrage-observatory venue survey probe"

BOOK_SECONDS = 30 if "--short" in sys.argv else 90
BOOK_SYMBOLS = ["BTC/USDT", "ETH/USDT", "BTC/USD", "BTC/USD_LEVERAGE", "ETH/USD_LEVERAGE"]


def now_ms():
    return int(time.time() * 1000)


def short(obj, n=600):
    s = obj if isinstance(obj, str) else json.dumps(obj, separators=(",", ":"))
    return s if len(s) <= n else s[:n] + "...(trimmed)"


def spot_trading_crypto():
    req = urllib.request.Request(REST + "/exchangeInfo", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        info = json.load(r)
    seen = []
    for s in info["symbols"]:
        if s["marketType"] == "SPOT" and s["assetType"] == "CRYPTOCURRENCY" and s["status"] == "TRADING" and s["symbol"] not in seen:
            seen.append(s["symbol"])
    return seen


class Session:
    def __init__(self, ws, log):
        self.ws = ws
        self.cid = 0
        self.log = log

    async def send(self, destination, payload):
        self.cid += 1
        frame = {"destination": destination, "correlationId": self.cid, "payload": payload}
        await self.ws.send(json.dumps(frame))
        self.log.append({"t": now_ms(), "dir": "out", "frame": frame})
        return self.cid


def book_levels(payload):
    data = payload.get("data") or payload.get("Data") or {}
    bid = data.get("bid") or data.get("Bid") or {}
    ofr = data.get("ofr") or data.get("Ofr") or {}
    return data, bid, ofr


async def mode_book():
    print("\n## mode book")
    log = []
    t0 = time.perf_counter()
    async with websockets.connect(URL, user_agent_header=UA, max_size=2**24, ping_interval=None) as ws:
        print(f"handshake {1000 * (time.perf_counter() - t0):.0f} ms, extensions={[e.name for e in ws.protocol.extensions]}")
        print("response headers:", {k: ws.response.headers.get_all(k) for k in ("Sec-WebSocket-Extensions", "Server", "CF-RAY")})
        s = Session(ws, log)
        await s.send("depthMarketData.subscribe", {"symbols": BOOK_SYMBOLS})
        await s.send("marketData.subscribe", {"symbols": ["BTC/USDT", "BTC/USD_LEVERAGE"]})
        await s.send("/api/v2/depth", {"symbol": "BTC/USDT", "limit": 5})
        await s.send("ping", {})

        dest_count = collections.Counter()
        quotes = collections.Counter()
        per_symbol = collections.defaultdict(list)  # symbol to list of (recv ms, ts, nbid, nofr, raw data)
        firsts = {}
        pings = []
        end = time.time() + BOOK_SECONDS
        next_ping = time.time() + 15
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, min(end, next_ping) - time.time()))
            except asyncio.TimeoutError:
                if time.time() >= next_ping and end - time.time() > 3:
                    sent = now_ms()
                    cid = await s.send("ping", {})
                    pings.append((cid, sent))
                    next_ping = time.time() + 15
                continue
            r = now_ms()
            msg = json.loads(raw)
            log.append({"t": r, "dir": "in", "frame": msg})
            dest = msg.get("destination") or msg.get("Destination")
            key = (dest, msg.get("status"))
            dest_count[key] += 1
            if key not in firsts:
                firsts[key] = raw
            if dest == "internal.quote":
                quotes[(msg.get("payload") or {}).get("symbolName")] += 1
            if dest == "marketdepth.event":
                p = msg.get("payload") or msg.get("Payload")
                data, bid, ofr = book_levels(p)
                per_symbol[p.get("symbol")].append((r, data.get("ts"), len(bid), len(ofr), json.dumps(data, sort_keys=True), bid, ofr))

        print("frames by (destination, status):", dict(dest_count))
        print("internal.quote frames by symbolName:", dict(quotes))
        print("symbols subscribed for depth with no depth frame:", [x for x in BOOK_SYMBOLS if x not in per_symbol])
        for key, raw in firsts.items():
            print(f"first {key}: {short(raw)}")
        for sym, rows in per_symbol.items():
            gaps = [b[0] - a[0] for a, b in zip(rows, rows[1:])]
            ts = [x[1] for x in rows]
            repeats = sum(1 for a, b in zip(rows, rows[1:]) if a[4] == b[4])
            backwards = sum(1 for a, b in zip(ts, ts[1:]) if a is not None and b is not None and b < a)
            lag = [x[0] - x[1] for x in rows if x[1]]
            nb = collections.Counter(x[2] for x in rows)
            no = collections.Counter(x[3] for x in rows)
            first = rows[0]
            bid_prices = [float(k) for k in first[5]]
            ofr_prices = [float(k) for k in first[6]]
            bid_order = "descending" if bid_prices == sorted(bid_prices, reverse=True) else ("ascending" if bid_prices == sorted(bid_prices) else "unordered")
            ofr_order = "ascending" if ofr_prices == sorted(ofr_prices) else ("descending" if ofr_prices == sorted(ofr_prices, reverse=True) else "unordered")
            print(
                f"{sym}: {len(rows)} frames in {BOOK_SECONDS} s, median gap {sorted(gaps)[len(gaps) // 2] if gaps else None} ms, max gap {max(gaps) if gaps else None} ms, "
                f"identical consecutive {repeats}, ts backwards {backwards}, recv minus ts median {sorted(lag)[len(lag) // 2] if lag else None} ms, "
                f"bid level counts {dict(nb)}, ofr level counts {dict(no)}, first frame bid keys {bid_order}, ofr keys {ofr_order}, "
                f"first bid keys {list(first[5])[:5]}, first ofr keys {list(first[6])[:5]}"
            )
        for cid, sent in pings:
            ans = [x for x in log if x["dir"] == "in" and str(x["frame"].get("correlationId")) == str(cid)]
            print(f"ping cid {cid}: answer {short(ans[0]['frame']) if ans else None} after {ans[0]['t'] - sent if ans else None} ms")
    (WORK / "ws-book-capture.json").write_text(json.dumps(log[:400], indent=1))


async def mode_errors():
    print("\n## mode errors")
    async with websockets.connect(URL, user_agent_header=UA, ping_interval=None) as ws:
        s = Session(ws, [])
        await s.send("depthMarketData.subscribe", {"symbols": ["NOPE/USD"]})
        await s.send("depthMarketData.subscribe", {"symbols": ["BTC/USDT_LEVERAGE"]})
        await s.send("noSuchDestination.subscribe", {"symbols": ["BTC/USDT"]})
        await ws.send("this is not json")
        end = time.time() + 8
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - time.time())
            except asyncio.TimeoutError:
                break
            except websockets.ConnectionClosed as e:
                print(f"closed code={e.code} reason={e.reason!r}")
                break
            msg = json.loads(raw)
            if (msg.get("destination") or msg.get("Destination")) == "marketdepth.event":
                print("depth event for", (msg.get("payload") or msg.get("Payload")).get("symbol"))
                continue
            print("frame:", short(raw))
    print("\n## alternate host from the docs sample")
    try:
        async with websockets.connect(ALT_URL, user_agent_header=UA, ping_interval=None, open_timeout=15) as ws:
            print("connected to", ALT_URL)
    except Exception as e:
        print(f"{ALT_URL}: {type(e).__name__} {e}")


async def mode_wide(symbols):
    print(f"\n## mode wide, {len(symbols)} symbols in one frame")
    async with websockets.connect(URL, user_agent_header=UA, ping_interval=None, max_size=2**24) as ws:
        s = Session(ws, [])
        await s.send("depthMarketData.subscribe", {"symbols": symbols})
        got = collections.Counter()
        other = []
        processed = []
        end = time.time() + 30
        next_ping = time.time() + 15
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=1)
            except asyncio.TimeoutError:
                pass
            else:
                msg = json.loads(raw)
                if (msg.get("destination") or msg.get("Destination")) == "marketdepth.event":
                    got[(msg.get("payload") or msg.get("Payload")).get("symbol")] += 1
                elif msg.get("destination") == "depthMarketData.subscribe":
                    subs = msg["payload"]["subscriptions"]
                    print("subscribe answer statuses:", dict(collections.Counter(subs.values())))
                    processed = [k for k, v in subs.items() if v == "PROCESSED"]
                    print("processed:", processed)
                else:
                    other.append(short(raw, 300))
            if time.time() >= next_ping:
                await s.send("ping", {})
                next_ping = time.time() + 15
        print(f"symbols with at least one depth frame: {len(got)} of {len(symbols)}, frames {sum(got.values())}")
        print("processed but silent for 30 s:", [x for x in processed if x not in got])
        print("non-depth frames:", other[:4])


async def mode_leverage():
    print("\n## mode leverage, leverage symbols alone for 30 s")
    async with websockets.connect(URL, user_agent_header=UA, ping_interval=None) as ws:
        s = Session(ws, [])
        await s.send("depthMarketData.subscribe", {"symbols": ["BTC/USD_LEVERAGE", "ETH/USD_LEVERAGE", "SOL/USD_LEVERAGE"]})
        await s.send("marketData.subscribe", {"symbols": ["BTC/USD_LEVERAGE", "ETH/USD_LEVERAGE", "SOL/USD_LEVERAGE"]})
        seen = collections.Counter()
        firsts = {}
        end = time.time() + 30
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            msg = json.loads(raw)
            p = msg.get("payload") or {}
            key = (msg.get("destination"), p.get("symbol") or p.get("symbolName"))
            seen[key] += 1
            firsts.setdefault(key, raw)
        print("frames by (destination, symbol):", dict(seen))
        for key, raw in firsts.items():
            print(f"first {key}: {short(raw, 400)}")


async def hold(label, subscribe):
    t0 = time.time()
    n = 0
    async with websockets.connect(URL, user_agent_header=UA, ping_interval=None) as ws:
        if subscribe:
            await Session(ws, []).send("depthMarketData.subscribe", {"symbols": ["BTC/USDT"]})
        try:
            while time.time() - t0 < 75:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=1)
                    n += 1
                except asyncio.TimeoutError:
                    pass
            print(f"{label}: still open after {time.time() - t0:.1f} s, {n} frames")
        except websockets.ConnectionClosed as e:
            print(f"{label}: closed after {time.time() - t0:.1f} s, code={e.code} reason={e.reason!r}, {n} frames before close")


async def mode_silence():
    print("\n## mode silence, no ping sent, one socket subscribed and one with nothing sent at all, capped at 75 s")
    await asyncio.gather(hold("subscribed to BTC/USDT depth", True), hold("no frame sent", False))


async def main():
    WORK.mkdir(parents=True, exist_ok=True)
    symbols = spot_trading_crypto()
    await mode_book()
    await mode_errors()
    await mode_wide(symbols)
    await mode_leverage()
    await mode_silence()


if __name__ == "__main__":
    asyncio.run(main())
