# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Cofinex WebSocket probe for docs/profiles/cofinex/websocket.md.

Public, unauthenticated and read-only.
The socket is the one the cofinex.io web app opens, found in its Next.js bundle.
It holds sockets open for about 4.5 minutes of wall time, one at a time:
  A. 60 s of SPOT Books on BTC/USDT: cadence, levels, seq, pseq, ts lag, level order, identical repeats.
  B. 20 s of SPOT Books on BTC/USDT and ETH/USDT on one socket: does a frame name its symbol.
  C. 15 s each of Books with productType FUTURE, USDT-FUTURES and UMCBL on BTC/USDT, alone on a socket.
  D. 6 s of SPOT Books on an unknown symbol, then a malformed frame, a text ping and two JSON pings, each on a fresh socket.
  E. 10 s of the Ticker, Trade and Summary channels on BTC/USDT, first frame of each.
  F. 90 s with no subscription and no client ping, to see whether the server closes an idle socket.
  G. 12 s of SPOT Books on BTC/USDT, with the top of book set against Bitget's own REST book every 2 s.
Run from the repository root with: uv run scripts/probes/venues/cofinex/ws-probe.py
Captured frames go to .claude/survey-work/cofinex/ws-capture.jsonl.
"""

import asyncio
import json
import pathlib
import statistics
import sys
import time
import urllib.request

import websockets

URL = "wss://wss1.cofinex.io/api/v1/ws/1"  # NEXT_PUBLIC_WS_URL fallback in the web bundle
OUT = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "cofinex" / "ws-capture.jsonl"


def sub(channel, symbol, base, product="SPOT", kind="subscribe"):
    return json.dumps({"type": kind, "channel": channel, "productType": product, "symbol": symbol, "base": base})


def log(fh, section, direction, data):
    fh.write(json.dumps({"t": time.time(), "section": section, "dir": direction, "data": data}) + "\n")


def trim(frame: str, n: int = 3) -> str:
    try:
        d = json.loads(frame)
    except json.JSONDecodeError:
        return frame[:300]
    if isinstance(d, list) and d and isinstance(d[0], dict) and "bids" in d[0]:
        x = dict(d[0])
        nb, na = len(x["bids"]), len(x["asks"])
        x["bids"] = x["bids"][:n] + [f"... {nb} levels"]
        x["asks"] = x["asks"][:n] + [f"... {na} levels"]
        return json.dumps([x] + ([f"... {len(d)} items"] if len(d) > 1 else []))[:700]
    return json.dumps(d)[:700]


async def connect():
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, ping_interval=None, max_size=None, open_timeout=20)
    return ws, time.perf_counter() - t0


async def collect(ws, seconds, fh, section):
    frames = []
    end = time.time() + seconds
    while time.time() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time()))
        except asyncio.TimeoutError:
            break
        frames.append((time.time(), m))
        log(fh, section, "in", m)
    return frames


def books(frames):
    out = []
    for t, m in frames:
        try:
            d = json.loads(m)
        except json.JSONDecodeError:
            continue
        if isinstance(d, list) and d and isinstance(d[0], dict) and "bids" in d[0]:
            out.append((t, d))
    return out


async def section_a(fh):
    ws, open_s = await connect()
    hello = await ws.recv()
    log(fh, "A", "in", hello)
    print(f"A open {open_s * 1000:.0f} ms, status {ws.response.status_code}, server {ws.response.headers.get('server')}, extensions {ws.response.headers.get('sec-websocket-extensions')}")
    print("A hello", hello)
    t_sub = time.time()
    await ws.send(sub("Books", "BTC", "USDT"))
    frames = await collect(ws, 60, fh, "A")
    await ws.close()
    b = books(frames)
    print(f"A frames {len(frames)}, book frames {len(b)}, other frames {len(frames) - len(b)}")
    if not b:
        return
    print(f"A first book after {(b[0][0] - t_sub) * 1000:.0f} ms")
    print("A first book", trim(b[0][1] and json.dumps(b[0][1])))
    gaps = [(b[i][0] - b[i - 1][0]) * 1000 for i in range(1, len(b))]
    print(f"A interval ms min {min(gaps):.0f} median {statistics.median(gaps):.0f} p90 {sorted(gaps)[int(len(gaps) * 0.9)]:.0f} max {max(gaps):.0f}")
    items = [len(d) for _, d in b]
    keys = sorted({tuple(sorted(d[0].keys())) for _, d in b})
    lv = sorted({(len(d[0]["bids"]), len(d[0]["asks"])) for _, d in b})
    print(f"A items per frame {sorted(set(items))}, keys {keys}, levels (bids, asks) {lv}")
    seqs = [d[0].get("seq") for _, d in b]
    pseqs = sorted({d[0].get("pseq") for _, d in b})
    steps = [seqs[i] - seqs[i - 1] for i in range(1, len(seqs)) if isinstance(seqs[i], int) and isinstance(seqs[i - 1], int)]
    print(f"A seq first {seqs[0]} last {seqs[-1]}, increasing {all(s > 0 for s in steps)}, non-increasing steps {sum(1 for s in steps if s <= 0)}, step min {min(steps) if steps else None} max {max(steps) if steps else None}, pseq values {pseqs}")
    lags = [t * 1000 - int(d[0]["ts"]) for t, d in b if "ts" in d[0]]
    print(f"A local receive minus ts ms min {min(lags):.0f} median {statistics.median(lags):.0f} max {max(lags):.0f}")
    asc = all(all(float(x[i][0]) < float(x[i + 1][0]) for i in range(len(x) - 1)) for x in (d[0]["asks"] for _, d in b))
    desc = all(all(float(x[i][0]) > float(x[i + 1][0]) for i in range(len(x) - 1)) for x in (d[0]["bids"] for _, d in b))
    crossed = sum(1 for _, d in b if float(d[0]["bids"][0][0]) >= float(d[0]["asks"][0][0]))
    zero = sum(1 for _, d in b for side in ("bids", "asks") for lvl in d[0][side] if float(lvl[1]) == 0)
    same = sum(1 for i in range(1, len(b)) if b[i][1][0]["bids"] == b[i - 1][1][0]["bids"] and b[i][1][0]["asks"] == b[i - 1][1][0]["asks"])
    dup_seq = sum(1 for i in range(1, len(seqs)) if seqs[i] == seqs[i - 1])
    print(f"A asks ascending {asc}, bids descending {desc}, crossed frames {crossed}, zero size levels {zero}, frames identical to previous {same}, repeated seq {dup_seq}")
    print(f"A sample level types {type(b[0][1][0]['bids'][0][0]).__name__} {type(b[0][1][0]['bids'][0][1]).__name__}, ts type {type(b[0][1][0]['ts']).__name__}, seq type {type(b[0][1][0]['seq']).__name__}")


async def section_b(fh):
    ws, _ = await connect()
    log(fh, "B", "in", await ws.recv())
    await ws.send(sub("Books", "BTC", "USDT"))
    await ws.send(sub("Books", "ETH", "USDT"))
    frames = await collect(ws, 20, fh, "B")
    await ws.close()
    b = books(frames)
    btc = sum(1 for _, d in b if float(d[0]["bids"][0][0]) > 20000)
    eth = len(b) - btc
    named = sum(1 for _, d in b if any(k in d[0] for k in ("symbol", "s", "instId", "channel", "pair")))
    print(f"B two symbols on one socket: book frames {len(b)}, BTC priced {btc}, ETH priced {eth}, frames carrying a symbol field {named}")


async def section_c(fh):
    for product in ("FUTURE", "USDT-FUTURES", "UMCBL"):
        ws, _ = await connect()
        log(fh, "C", "in", await ws.recv())
        await ws.send(sub("Books", "BTC", "USDT", product))
        frames = await collect(ws, 15, fh, f"C-{product}")
        await ws.close()
        b = books(frames)
        print(f"C productType {product}: frames {len(frames)}, book frames {len(b)}")
        for _, m in frames[:2]:
            print("C   ", trim(m))


async def section_d(fh):
    ws, _ = await connect()
    log(fh, "D", "in", await ws.recv())
    await ws.send(sub("Books", "NOTACOIN", "USDT"))
    frames = await collect(ws, 6, fh, "D-unknown")
    print(f"D unknown symbol: frames {len(frames)}")
    for _, m in frames[:2]:
        print("D   ", trim(m))
    await ws.close()
    for probe in ("{not json", "ping", json.dumps({"type": "ping"}), json.dumps({"op": "ping"})):
        ws, _ = await connect()
        log(fh, "D", "in", await ws.recv())
        log(fh, "D", "out", probe)
        await ws.send(probe)
        try:
            frames = await collect(ws, 3, fh, "D-" + probe[:10])
            print(f"D sent {probe!r} on a fresh socket: frames {len(frames)}", [trim(m) for _, m in frames[:2]], f"state {ws.state.name}")
        except websockets.ConnectionClosed as e:
            print(f"D sent {probe!r} on a fresh socket: server closed it, code {e.rcvd.code if e.rcvd else None} reason {e.rcvd.reason if e.rcvd else None!r}")
        await ws.close()
    ws, _ = await connect()
    log(fh, "D", "in", await ws.recv())
    t0 = time.perf_counter()
    pong = await ws.ping()
    try:
        await asyncio.wait_for(pong, 5)
        print(f"D protocol ping answered in {(time.perf_counter() - t0) * 1000:.0f} ms")
    except asyncio.TimeoutError:
        print("D protocol ping not answered in 5 s")
    await ws.close()


async def section_e(fh):
    ws, _ = await connect()
    log(fh, "E", "in", await ws.recv())
    for ch in ("Ticker", "Trade", "Summary"):
        await ws.send(sub(ch, "BTC", "USDT"))
        frames = await collect(ws, 3.3, fh, f"E-{ch}")
        print(f"E {ch}: frames {len(frames)}")
        for _, m in frames[:1]:
            print("E   ", trim(m))
        await ws.send(sub(ch, "BTC", "USDT", kind="unsubscribe"))
    await ws.close()


async def section_f(fh):
    ws, _ = await connect()
    log(fh, "F", "in", await ws.recv())
    t0 = time.time()
    frames = await collect(ws, 90, fh, "F")
    print(f"F idle socket, no subscription, no client ping: frames {len(frames)}, open after {time.time() - t0:.0f} s {ws.state.name}, close code {ws.close_code}")
    for _, m in frames[:3]:
        print("F   ", trim(m))
    await ws.close()


async def section_g(fh):
    ws, _ = await connect()
    log(fh, "G", "in", await ws.recv())
    await ws.send(sub("Books", "BTC", "USDT"))
    last = None
    end = time.time() + 12
    nxt = time.time() + 2
    while time.time() < end:
        try:
            m = await asyncio.wait_for(ws.recv(), timeout=0.5)
            d = json.loads(m)
            if isinstance(d, list) and d and "bids" in d[0]:
                last = d[0]
        except asyncio.TimeoutError:
            pass
        if last and time.time() >= nxt:
            nxt = time.time() + 2
            bb, ba = await asyncio.to_thread(bitget_top)
            print(f"G Cofinex socket top {last['bids'][0][0]} / {last['asks'][0][0]} seq {last['seq']}, Bitget REST top {bb} / {ba}")
    await ws.close()


def bitget_top():
    req = urllib.request.Request("https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=1", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        d = json.load(r)["data"]
    return d["bids"][0][0], d["asks"][0][0]


async def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w") as fh:
        for f in (section_a, section_b, section_c, section_d, section_e, section_f, section_g):
            try:
                await f(fh)
            except Exception as e:  # record and continue, each section is independent
                print(f"{f.__name__} failed: {type(e).__name__}: {e}")
            sys.stdout.flush()


if __name__ == "__main__":
    asyncio.run(main())
