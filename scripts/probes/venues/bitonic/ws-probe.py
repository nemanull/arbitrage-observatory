# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe for a Bitonic WebSocket, which the venue does not publish.

Modes, all by default, or name some on the command line:
    docs       the public API page, searched for any socket, stream or order book word
    sitejs     the home page script and the web app scripts of /en/trade, searched for WebSocket and EventSource use and for the price refresh timer
    handshake  one WebSocket handshake each to a few likely paths on bitonic.nl and to the old BL3P socket paths, held at most 5 s

Each handshake is a single unauthenticated upgrade request that sends nothing after it opens.
The probe waits 7 s between calls to bitonic.nl, because the API page asks for at most 10 requests per minute.

Run from the repository root:
    uv run scripts/probes/venues/bitonic/ws-probe.py [mode ...]
"""

import asyncio
import json
import re
import sys
import time
import urllib.error
import urllib.request

import websockets

SITE = "https://bitonic.nl"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
GAP_S = 7.0
_last = [0.0]


def pace() -> None:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def get(url: str) -> tuple[int, bytes]:
    pace()
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def mode_docs() -> None:
    s, b = get(SITE + "/en/api")
    raw = b.decode(errors="replace").lower()
    words = {w: raw.count(w) for w in ("websocket", "wss://", "socket", "stream", "orderbook", "order book", "depth")}
    out(mode="docs", call="GET /en/api", status=s, bytes=len(b), word_counts=words)


def mode_sitejs() -> None:
    s, b = get(SITE + "/")
    home = b.decode(errors="replace")
    scripts = sorted(set(re.findall(r'src="(public/js/[^"]+\.js)"', home)))
    s2, b2 = get(SITE + "/en/trade")
    trade = b2.decode(errors="replace")
    chunks = sorted(set(re.findall(r'"(/webapp/assets/[^"]+\.js)"', trade)))
    urls = [SITE + "/" + p for p in scripts] + [SITE + p for p in chunks]
    totals = {"files": 0, "bytes": 0, "new_WebSocket": 0, "EventSource_ctor": 0, "wss_urls": set(), "refresh": set()}
    for url in urls:
        st, body = get(url)
        js = body.decode(errors="replace")
        totals["files"] += 1
        totals["bytes"] += len(body)
        totals["new_WebSocket"] += len(re.findall(r"new WebSocket\(", js))
        totals["EventSource_ctor"] += len(re.findall(r"new EventSource\(", js))
        totals["wss_urls"].update(re.findall(r"wss?://[A-Za-z0-9./_-]+", js))
        totals["refresh"].update(re.findall(r'refreshInterval:\d+e?\d*,refreshUrl:"[^"]+"', js))
    totals["wss_urls"] = sorted(totals["wss_urls"])
    totals["refresh"] = sorted(totals["refresh"])
    out(mode="sitejs", home_status=s, trade_status=s2, scripts=scripts, webapp_chunks=len(chunks), **totals)


async def try_ws(url: str) -> None:
    if "bitonic.nl" in url:
        pace()
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=8, user_agent_header=UA["User-Agent"]) as ws:
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                first = None
            out(mode="handshake", url=url, opened=True, ms=round((time.perf_counter() - t0) * 1000),
                first_frame=(first[:200] if isinstance(first, str) else first))
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        out(mode="handshake", url=url, opened=False, status=r.status_code,
            body=(r.body or b"")[:120].decode(errors="replace").replace("\n", " "))
    except Exception as e:  # noqa: BLE001, every failure shape is a result here
        out(mode="handshake", url=url, opened=False, error=repr(e)[:200])


def mode_handshake() -> None:
    for url in ("wss://bitonic.nl/ws", "wss://bitonic.nl/websocket", "wss://bitonic.nl/api/ws",
                "wss://api.bl3p.eu/1/BTCEUR/orderbook", "wss://api.bl3p.eu/1/BTCEUR/trades"):
        asyncio.run(try_ws(url))


MODES = {"docs": mode_docs, "sitejs": mode_sitejs, "handshake": mode_handshake}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="bitonic ws", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for name in picked:
        MODES[name]()
