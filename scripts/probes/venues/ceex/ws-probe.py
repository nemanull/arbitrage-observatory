# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""CEEX WebSocket probe for docs/profiles/ceex/websocket.md.

Public, unauthenticated and read-only, about five minutes of socket time in total.
  1. Handshake on wss://www.ceex.com/new_w_quote/stream, with and without permessage-deflate offered.
  2. TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_100 for 15 s: frame interval, level count, level order, whether frames are full books.
  3. The same channel with binary true, inflated with zlib, and an aggregated level channel.
  4. All eleven perpetual book channels on one socket for 10 s.
  5. TRIGGER_CONTRACT_TICKER_ALL for 75 s with no client ping: mark, funding rate and next funding time per symbol, how often each changes, and whether the subscribed socket survives past 60 s.
  6. TRIGGER_CONTRACT_TRADE_BTCUSDT, an unknown symbol, an unknown channel, removeChannel and the ping event.
  7. A socket with no subscription held 65 s, then one held 70 s with {"event":"ping"} every 20 s.
  8. The legacy BHEX socket paths the bundle names, for the coverage matrix.
  9. OKX BTC-USDT-SWAP best bid and ask beside the CEEX book, once.
Run from the repository root with: uv run scripts/probes/venues/ceex/ws-probe.py
The second pass runs: uv run scripts/probes/venues/ceex/ws-probe.py --quick
which repeats sections 1, 2, 5 and 6 with 10 s and 20 s windows, about 45 s of socket time.
"""

import asyncio
import json
import statistics
import sys
import time
import urllib.request
import zlib

import websockets

URL = "wss://www.ceex.com/new_w_quote/stream"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"
QUICK = "--quick" in sys.argv
SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT", "AVAXUSDT", "DOTUSDT", "SUIUSDT", "UNIUSDT", "LINKUSDT"]


def sub(channel, binary=False, **extra):
    return json.dumps({"id": channel, "event": "addChannel", "channel": channel, "params": {"binary": binary, **extra}})


def decode(m):
    if isinstance(m, bytes):
        return json.loads(zlib.decompress(m).decode()), True
    return json.loads(m), False


async def connect(compression=None):
    return await websockets.connect(URL, compression=compression, user_agent_header=UA, open_timeout=20, close_timeout=3, ping_interval=None, max_size=2**23)


def short(obj, n=400):
    return json.dumps(obj, separators=(",", ":"))[:n]


async def collect(ws, seconds):
    out = []
    t0 = time.time()
    while time.time() - t0 < seconds:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=max(0.1, seconds - (time.time() - t0)))
        except asyncio.TimeoutError:
            break
        msg, binary = decode(m)
        out.append((time.time(), len(m), binary, msg))
    return out


async def section_handshake():
    print("== 1. Handshake")
    t0 = time.perf_counter()
    ws = await connect()
    print(f"open in {(time.perf_counter() - t0) * 1000:.0f} ms, status {ws.response.status_code}, headers {dict(ws.response.headers)}")
    await ws.close()
    ws = await connect(compression="deflate")
    ext = ws.response.headers.get("sec-websocket-extensions")
    print(f"permessage-deflate offered: server answered extensions={ext!r}")
    await ws.close()


def book_stats(frames, channel):
    books = [(t, n, b, m) for t, n, b, m in frames if m.get("channel") == channel and m.get("data")]
    if not books:
        print(f"{channel}: no book frames")
        return None
    gaps = [(books[i][0] - books[i - 1][0]) * 1000 for i in range(1, len(books))]
    first = books[0][3]
    d = first["data"]
    asks, bids = d.get("asks", []), d.get("bids", [])
    ap = [float(x["p"]) for x in asks]
    bp = [float(x["p"]) for x in bids]
    changed = sum(1 for i in range(1, len(books)) if books[i][3]["data"] != books[i - 1][3]["data"])
    crossed = sum(1 for _, _, _, m in books if m["data"]["asks"] and m["data"]["bids"] and min(float(x["p"]) for x in m["data"]["asks"]) <= max(float(x["p"]) for x in m["data"]["bids"]))
    print(f"{channel}: {len(books)} book frames, bytes {min(b[1] for b in books)} to {max(b[1] for b in books)}")
    if gaps:
        print(f"  interval ms median {statistics.median(gaps):.0f}, min {min(gaps):.0f}, max {max(gaps):.0f}")
    print(f"  levels asks {len(asks)} bids {len(bids)}, top level keys {sorted(asks[0].keys()) if asks else None}, frame keys {sorted(first.keys())}, data keys {sorted(d.keys())}")
    print(f"  asks first {ap[:2]} last {ap[-2:]} descending {ap == sorted(ap, reverse=True)}, bids first {bp[:2]} last {bp[-2:]} descending {bp == sorted(bp, reverse=True)}")
    print(f"  best ask {min(ap) if ap else None} best bid {max(bp) if bp else None} lastPrice {d.get('lastPrice')}, T {first.get('T')}, code {first.get('code')}")
    print(f"  frames whose data differs from the previous frame: {changed} of {len(books) - 1}, crossed frames {crossed}")
    print(f"  any sequence field: {[k for k in list(first.keys()) + list(d.keys()) if k.lower() in ('seq', 'sequence', 'u', 'version', 'v', 'id', 'updateid')]}")
    return books


async def section_book():
    print(f"== 2. Book channel BTCUSDT _100, text frames, {10 if QUICK else 15} s")
    ws = await connect()
    ch = "TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_100"
    await ws.send(sub(ch))
    frames = await collect(ws, 10 if QUICK else 15)
    acks = [m for _, _, _, m in frames if m.get("channel") == ch and not m.get("data")]
    print(f"acknowledgement frames without data: {[short(a) for a in acks[:2]]}")
    print(f"first frame trimmed: {short(frames[0][3], 500)}")
    f0 = next((m for _, _, _, m in frames if m.get("data")), None)
    if f0:
        d = f0["data"]
        trimmed = {**f0, "data": {"asks": d["asks"][:2] + d["asks"][-1:], "bids": d["bids"][:2], "lastPrice": d.get("lastPrice")}}
        print(f"first frame with asks 1, 2 and 100 and bids 1 and 2: {short(trimmed, 600)}")
    books = book_stats(frames, ch)
    await ws.close()
    return books[-1][3] if books else None


async def section_binary_and_levels():
    print("== 3. binary true, and aggregated level channels")
    ws = await connect()
    await ws.send(sub("TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_100", binary=True))
    for ch in ("TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_A", "TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_B", "TRIGGER_CONTRACT_ORDERBOOK_BTCUSDT_20"):
        await ws.send(sub(ch))
    frames = await collect(ws, 8)
    kinds = {}
    for _, n, b, m in frames:
        key = (m.get("channel"), b)
        kinds.setdefault(key, []).append((n, len((m.get("data") or {}).get("asks", [])), len((m.get("data") or {}).get("bids", [])), m.get("code"), m.get("msg")))
    for (ch, b), v in kinds.items():
        print(f"{ch} binary={b}: {len(v)} frames, first (bytes, asks, bids, code, msg) {v[0]}, last {v[-1]}")
    for _, _, _, m in frames:
        if m.get("channel", "").endswith("_A") and m.get("data"):
            a = [float(x["p"]) for x in m["data"]["asks"]][-3:]
            print(f"_A best asks {a}")
            break
    await ws.close()


async def section_all_books():
    print("== 4. All eleven book channels on one socket, 10 s")
    ws = await connect()
    for s in SYMBOLS:
        await ws.send(sub(f"TRIGGER_CONTRACT_ORDERBOOK_{s}_100"))
    frames = await collect(ws, 10)
    for s in SYMBOLS:
        ch = f"TRIGGER_CONTRACT_ORDERBOOK_{s}_100"
        b = [(t, m) for t, _, _, m in frames if m.get("channel") == ch and m.get("data")]
        if not b:
            print(f"{s}: none")
            continue
        d = b[-1][1]["data"]
        bb = max(float(x["p"]) for x in d["bids"]) if d["bids"] else None
        ba = min(float(x["p"]) for x in d["asks"]) if d["asks"] else None
        changed = sum(1 for i in range(1, len(b)) if b[i][1]["data"] != b[i - 1][1]["data"])
        print(f"{s}: {len(b)} frames, levels {len(d['asks'])}/{len(d['bids'])}, bid {bb} ask {ba}, changed {changed}")
    print(f"total frames {len(frames)}, total bytes {sum(f[1] for f in frames)}")
    await ws.close()


async def section_ticker():
    print(f"== 5. TRIGGER_CONTRACT_TICKER_ALL, {20 if QUICK else 75} s, no client ping")
    ws = await connect()
    await ws.send(sub("TRIGGER_CONTRACT_TICKER_ALL"))
    try:
        frames = await collect(ws, 20 if QUICK else 75)
    except websockets.ConnectionClosed as e:
        print(f"subscribed socket closed: code {e.code} reason {e.reason!r}")
        return
    print(f"subscribed socket still open after {20 if QUICK else 75} s with no client ping: {ws.state.name}, last frame at {frames[-1][0] - frames[0][0]:.1f} s")
    tick = [(t, m) for t, _, _, m in frames if m.get("data") and m["data"].get("tickers")]
    print(f"ticker frames {len(tick)}, acknowledgement {[short(m) for _, _, _, m in frames if not m.get('data')][:1]}")
    if not tick:
        await ws.close()
        return
    gaps = [(tick[i][0] - tick[i - 1][0]) * 1000 for i in range(1, len(tick))]
    print(f"interval ms median {statistics.median(gaps):.0f}")
    first = tick[0][1]["data"]["tickers"]
    print(f"symbols {len(first)}: {sorted(x['symbol'] for x in first)}")
    print(f"ticker keys {sorted(first[0].keys())}")
    print(f"one ticker {short(first[0], 600)}")
    per = {}
    for _, m in tick:
        for x in m["data"]["tickers"]:
            per.setdefault(x["symbol"], []).append(x)
    for s, rows in sorted(per.items()):
        def changes(k):
            return sum(1 for i in range(1, len(rows)) if rows[i].get(k) != rows[i - 1].get(k))
        nft = rows[-1].get("nextFundingTime")
        print(f"{s}: frames {len(rows)}, markPrice {rows[-1].get('markPrice')} (changed {changes('markPrice')}), c {rows[-1].get('c')} (changed {changes('c')}), "
              f"fundingRate {rows[-1].get('fundingRate')} (changed {changes('fundingRate')}), nextFundingTime {nft} = {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime(nft / 1000)) if nft else None} UTC, "
              f"refPrice {rows[-1].get('refPrice')}, mark minus last {float(rows[-1]['markPrice']) - float(rows[-1]['c']):.6g}")
    await ws.close()


async def section_misc():
    print("== 6. Trades, unknown symbol, unknown channel, removeChannel, ping")
    ws = await connect()
    await ws.send(sub("TRIGGER_CONTRACT_TRADE_BTCUSDT"))
    await ws.send(sub("TRIGGER_CONTRACT_ORDERBOOK_NOPEUSDT_100"))
    await ws.send(sub("TRIGGER_CONTRACT_NOSUCH_BTCUSDT"))
    await ws.send(json.dumps({"event": "ping"}))
    frames = await collect(ws, 8)
    seen = {}
    for _, n, _, m in frames:
        seen.setdefault(m.get("channel") or m.get("event"), []).append((n, m))
    for k, v in seen.items():
        print(f"{k}: {len(v)} frames, first {short(v[0][1], 400)}")
    await ws.send(json.dumps({"event": "removeChannel", "channel": "TRIGGER_CONTRACT_TRADE_BTCUSDT"}))
    sent = time.time()
    after = await collect(ws, 4)
    print(f"after removeChannel: {len(after)} frames in 4 s, at {[round(t - sent, 2) for t, _, _, _ in after]} s, channels {sorted(set(str(m.get('channel') or m.get('event')) for _, _, _, m in after))}")
    await ws.send("ping")
    raw = await collect(ws, 3)
    print(f"plain text ping answered with: {[short(m) for _, _, _, m in raw][:2]}")
    await ws.close()


async def idle(seconds, ping_every=None):
    ws = await connect()
    t0 = time.time()
    next_ping = ping_every
    try:
        while time.time() - t0 < seconds:
            wait = seconds - (time.time() - t0)
            if next_ping is not None:
                wait = min(wait, max(0.05, next_ping - (time.time() - t0)))
            try:
                m = await asyncio.wait_for(ws.recv(), timeout=wait)
                print(f"  {time.time() - t0:.1f} s: {m[:120] if isinstance(m, str) else m[:40]}")
            except asyncio.TimeoutError:
                if next_ping is not None and time.time() - t0 >= next_ping:
                    await ws.send(json.dumps({"event": "ping"}))
                    next_ping += ping_every
        print(f"  open after {time.time() - t0:.0f} s, no close")
    except websockets.ConnectionClosed as e:
        print(f"  closed after {time.time() - t0:.1f} s: code {e.code} reason {e.reason!r}")
    await ws.close()


async def section_idle():
    print("== 7. Idle socket, no subscription, 65 s, no ping")
    await idle(65)
    print("== 7b. Idle socket, no subscription, 70 s, ping every 20 s")
    await idle(70, ping_every=20)


async def section_legacy():
    print("== 8. Legacy BHEX socket paths")
    for url in ("wss://www.ceex.com/ws/quote/v1", "wss://www.ceex.com/openapi/quote/ws/v1", "wss://wsapi.ceex.com/openapi/quote/ws/v1", "wss://www.ceex.com/api/ws-vb/linear-swap-ws"):
        try:
            await asyncio.wait_for(legacy_one(url), 25)
        except asyncio.TimeoutError:
            print(f"{url}: no result within 25 s")


async def legacy_one(url):
    try:
        ws = await asyncio.wait_for(websockets.connect(url, compression=None, user_agent_header=UA, open_timeout=15, close_timeout=3, ping_interval=None), 20)
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:160]}")
        return
    await ws.send(json.dumps({"symbol": "BTC-SWAP-USDT", "topic": "depth", "event": "sub", "params": {"binary": False}}))
    await ws.send(json.dumps({"symbol": "BTCUSDT", "topic": "depth", "event": "sub", "params": {"binary": False}}))
    await ws.send(json.dumps({"id": "d", "topic": "depth", "event": "sub", "symbol": "301.BTC-SWAP-USDT", "params": {"binary": False}}))
    out = []
    t0 = time.time()
    try:
        while time.time() - t0 < 6:
            m = await asyncio.wait_for(ws.recv(), timeout=6 - (time.time() - t0))
            if isinstance(m, bytes):
                try:
                    m = zlib.decompress(m).decode()
                except zlib.error:
                    m = repr(m[:60])
            out.append(m)
    except (asyncio.TimeoutError, websockets.ConnectionClosed) as e:
        out.append(f"<{type(e).__name__}>")
    print(f"{url}: open, {len(out)} frames: {[o[:260] for o in out[:4]]}")
    await ws.close()


def okx_beside(book):
    print("== 9. OKX BTC-USDT-SWAP beside the CEEX BTCUSDT book")
    try:
        r = json.load(urllib.request.urlopen(urllib.request.Request("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT-SWAP", headers={"User-Agent": UA}), timeout=15))
        t = r["data"][0]
        print(f"OKX bid {t['bidPx']} ask {t['askPx']} last {t['last']}")
    except Exception as e:
        print(f"OKX: {type(e).__name__}: {e}")
    if book:
        d = book["data"]
        print(f"CEEX bid {max(float(x['p']) for x in d['bids'])} ask {min(float(x['p']) for x in d['asks'])} lastPrice {d.get('lastPrice')}")


async def main():
    sys.stdout.reconfigure(line_buffering=True)
    print(f"host UTC {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
    await section_handshake()
    book = await section_book()
    okx_beside(book)
    if not QUICK:
        await section_binary_and_levels()
        await section_all_books()
    await section_ticker()
    await section_misc()
    if not QUICK:
        await section_idle()
        await section_legacy()


asyncio.run(main())
