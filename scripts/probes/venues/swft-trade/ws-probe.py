# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for SWFT Trade.

The TRADE API documentation names no WebSocket, so this probe looks for one in two ways.
It searches the documentation index and the scripts of both web front ends for ws:// or wss:// URLs.
It then tries one opening handshake on each of a few guessed paths of the API host, with a short timeout, and closes at once.
Total socket time is a few seconds.

Run from the repository root:
    uv run scripts/probes/venues/swft-trade/ws-probe.py
"""

import asyncio
import re
import time
import urllib.request

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"

TEXT_SOURCES = [
    "https://docs-swft.en.swft.pro/llms.txt",
    "https://www.swft.pro/",
    "https://www.swftc.info/swft-v3/swft-v3-pc/index.html",
    "https://www.swftc.info/swft-v3/js/index/index.js",
    "https://www.swftc.info/swft-v3/main/js/all.min.js",
]

# Guesses, since nothing is documented. One handshake each.
GUESSES = [
    "wss://www.swftc.info/ws",
    "wss://www.swftc.info/websocket",
    "wss://www.swftc.info/marketApi/ws",
    "wss://www.swftc.info/market/ws",
]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read().decode("utf-8", "replace")


def scan() -> None:
    print("## ws URLs in documentation and front end scripts")
    for url in TEXT_SOURCES:
        try:
            text = fetch(url)
        except Exception as e:  # noqa: BLE001
            print(url, "error", e)
            continue
        found = sorted(set(re.findall(r"wss?://[A-Za-z0-9._:/?=&-]+", text)))
        mentions = len(re.findall(r"websocket", text, re.I))
        print(url, len(text), "chars, ws URLs", found, "word websocket", mentions)
        if url == "https://www.swft.pro/":
            bundle = re.search(r'src="\./(assets/index-[^"]+\.js)"', text)
            if bundle:
                b = fetch(f"https://www.swft.pro/{bundle.group(1)}")
                found = sorted(set(re.findall(r"wss?://[A-Za-z0-9._:/?=&-]+", b)))
                print(f"https://www.swft.pro/{bundle.group(1)}", len(b), "chars, ws URLs", found, "word websocket", len(re.findall(r"websocket", b, re.I)))


async def handshake(url: str) -> None:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10, user_agent_header=UA) as ws:
            print(url, "OPEN", round((time.perf_counter() - t0) * 1000), "ms")
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=3)
                print("   first frame", str(msg)[:200])
            except asyncio.TimeoutError:
                print("   no frame within 3 s")
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        print(url, "refused, HTTP", r.status_code, r.headers.get("Server"), r.body[:160].decode("utf-8", "replace") if r.body else "")
    except Exception as e:  # noqa: BLE001
        print(url, "failed", type(e).__name__, str(e)[:160], round((time.perf_counter() - t0) * 1000), "ms")


async def main() -> None:
    print("# probe started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    scan()
    print("\n## one handshake per guessed URL")
    for url in GUESSES:
        await handshake(url)
    print("# probe finished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    asyncio.run(main())
