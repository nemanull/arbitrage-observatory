# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe of Binibit's sockets, public channels only.

Binibit documents no WebSocket API.
The web bundle opens SignalR hubs on sockets-v2stage.binibit.com for the spot terminal, and the futures terminal polls REST.

Modes, all by default, or name some on the command line:
    bundle   the futures page chunk: its data calls, poll intervals and any socket code; the spot hub map and socket base
    hub      /sr/orderbook with the SignalR JSON protocol: handshake, ByCurrencyPair for a spot pair, a futures symbol and a junk code, 45 s
    deals    /sr/deals for one spot pair, 20 s

Sockets are held for about 70 s in total.
Captures go to .claude/survey-work/binibit/.

Run from the repository root:
    uv run scripts/probes/venues/binibit/ws-probe.py [mode ...]
"""

import asyncio
import collections
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

import websockets

SITE = "https://binibit.com"
SOCK = "wss://sockets-v2stage.binibit.com"
RS = "\x1e"  # SignalR record separator
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Origin": "https://binibit.com"}
WORK = Path(".claude/survey-work/binibit")


def get(url: str) -> bytes:
    time.sleep(1.0)
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": HEADERS["User-Agent"]}), timeout=20) as r:
        return r.read()


def chunk_urls(page_html: str) -> list[str]:
    return [SITE + u for u in re.findall(r'src="(/_next/static/chunks/[^"]+?\.js[^"]*)"', page_html)]


def bundle() -> None:
    print("== bundle")
    html = get(SITE + "/en/futures/BTC_USDT").decode(errors="replace")
    urls = chunk_urls(html)
    page = next(u for u in urls if "/futures/" in u and "/page-" in u)
    t = get(page).decode(errors="replace")
    print(f"futures page chunk {page.split('?')[0]} bytes={len(t)}")
    print("  futures-public calls:", sorted(set(re.findall(r'T\("([a-z]+)"', t))))
    print("  pollMs values:", re.findall(r"pollMs:([0-9e]+)", t))
    print("  depth default:", re.findall(r'set\("depth",String\(null!=\(r=t\.depth\)\?r:(\d+)\)\)', t))
    print("  /sr/ hub paths in futures page chunk:", sorted(set(re.findall(r'"(/sr/[a-z-]+)"', t))), "with accessTokenFactory:", "accessTokenFactory" in t)
    for word in ("WebSocket", "withUrl", "HubConnection", "sockets-", "wss://", "/sr/"):
        print(f"  {word!r} in futures page chunk: {word in t}")
    socket_base = hub_map = None
    for u in urls:
        c = get(u).decode(errors="replace")
        m = re.search(r'h\("(https://sockets-[^"]+)"\)', c)
        if m:
            socket_base = m.group(1)
        m = re.search(r'let r=\{MainOrders:\{path:"[^"]+",event:"[^"]+"\},MainDeals:\{path:"[^"]+",event:"[^"]+"\}\},a="[A-Za-z]+",l="[A-Za-z]+"', c)
        if m:
            hub_map = m.group(0)
    print("  socket base in bundle:", socket_base)
    print("  spot hub map:", hub_map if hub_map else "not in this page's chunks")


async def recv_all(ws, seconds: float, out: list) -> None:
    end = time.monotonic() + seconds
    while True:
        left = end - time.monotonic()
        if left <= 0:
            return
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return
        t = time.monotonic()
        for rec in (raw if isinstance(raw, str) else raw.decode()).split(RS):
            if rec:
                out.append((t, rec))


async def hub() -> None:
    print("== hub")
    url = SOCK + "/sr/orderbook"
    t0 = time.monotonic()
    async with websockets.connect(url, additional_headers=HEADERS, open_timeout=15, max_size=2**24) as ws:
        print(f"open {url} in {(time.monotonic() - t0) * 1000:.0f} ms, status={ws.response.status_code}, extensions={ws.response.headers.get('Sec-WebSocket-Extensions')}")
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
        frames: list = []
        await recv_all(ws, 3, frames)
        print("handshake reply:", [r for _, r in frames][:2])
        start = time.monotonic()
        for i, code in enumerate(("BTC_USDT", "BTCUSDT", "NOPE_XYZ")):
            await ws.send(json.dumps({"type": 1, "invocationId": str(i), "target": "ByCurrencyPair", "arguments": [code]}) + RS)
        await recv_all(ws, 45, frames)
    events = collections.Counter()
    by_pair = collections.Counter()
    first: dict[str, str] = {}
    times = []
    tops = []
    for t, rec in frames:
        try:
            m = json.loads(rec)
        except ValueError:
            events["non-json"] += 1
            continue
        kind = m.get("type")
        key = f"type{kind}" + (f":{m.get('target')}" if kind == 1 else "")
        events[key] += 1
        first.setdefault(key, rec[:700])
        if kind == 1 and m.get("target") == "OrderBook":
            arg = m["arguments"][0] if m.get("arguments") else None
            if isinstance(arg, str):
                try:
                    arg = json.loads(arg)
                except ValueError:
                    pass
            pair = (arg.get("CurrencyPairCode") or arg.get("currencyPairCode")) if isinstance(arg, dict) else None
            by_pair[str(pair)] += 1
            times.append(t)
            if isinstance(arg, dict):
                bids, asks = arg.get("bids") or [], arg.get("asks") or []
                tops.append((len(bids), len(asks), max((x["price"] for x in bids), default=None), min((x["price"] for x in asks), default=None)))
        if kind == 3:
            print("completion:", rec[:300])
    print("message counts:", dict(events))
    print("OrderBook events by pair:", dict(by_pair))
    if len(times) > 1:
        gaps = sorted(b - a for a, b in zip(times, times[1:]))
        print(f"OrderBook gaps s: min={gaps[0]:.2f} median={gaps[len(gaps) // 2]:.2f} max={gaps[-1]:.2f} over {times[-1] - start:.0f} s")
    print("OrderBook (bid levels, ask levels, best bid, best ask):", tops)
    print("events repeating the previous top of book:", sum(1 for a, b in zip(tops, tops[1:]) if a == b), "of", max(0, len(tops) - 1))
    for k, v in first.items():
        print(f"first {k}: {v}")
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "hub-orderbook-frames.txt").write_text("\n".join(r for _, r in frames))


async def deals() -> None:
    print("== deals")
    url = SOCK + "/sr/deals"
    async with websockets.connect(url, additional_headers=HEADERS, open_timeout=15) as ws:
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
        frames: list = []
        await ws.send(json.dumps({"type": 1, "invocationId": "0", "target": "ByCurrencyPair", "arguments": ["BTC_USDT"]}) + RS)
        await recv_all(ws, 20, frames)
    c = collections.Counter()
    first = {}
    for _, rec in frames:
        try:
            m = json.loads(rec)
        except ValueError:
            continue
        k = f"type{m.get('type')}" + (f":{m.get('target')}" if m.get("type") == 1 else "")
        c[k] += 1
        first.setdefault(k, rec[:400])
    print("message counts:", dict(c))
    for k, v in first.items():
        print(f"first {k}: {v}")


MODES = {"bundle": bundle, "hub": hub, "deals": deals}

if __name__ == "__main__":
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for m in sys.argv[1:] or list(MODES):
        r = MODES[m]()
        if asyncio.iscoroutine(r):
            asyncio.run(r)
