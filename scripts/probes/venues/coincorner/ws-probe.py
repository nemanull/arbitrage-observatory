# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets==15.0.1"]
# ///
"""Read-only search for a public CoinCorner WebSocket.

Modes:
  scan     fetch the public site and API pages and their scripts, and list every ws, wss, SignalR or socket string
  upgrade  try a WebSocket handshake on a few candidate URLs, holding each open for at most 10 s
  all      both modes, in order

No URL is documented, so the upgrade candidates are guesses, and each is tried once.
"""

import asyncio
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import websockets

UA = {"User-Agent": "Mozilla/5.0 (survey probe)"}
PAGES = [
    "https://www.coincorner.com/",
    "https://www.coincorner.com/buy-bitcoin",
    "https://www.coincorner.com/Login",
    "https://api.coincorner.com/",
]
CANDIDATES = [
    "wss://api.coincorner.com/",
    "wss://api.coincorner.com/ws",
    "wss://api.coincorner.com/signalr",
    "wss://www.coincorner.com/ws",
    "wss://www.coincorner.com/signalr",
]
PATTERN = re.compile(r"wss?://[^\"'\s<>)]{1,80}|signalr[^\"'\s<>]{0,40}|socket\.io|new WebSocket|websocket", re.I)


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def mode_scan() -> None:
    print(f"## scan {now()}")
    seen = set()
    for page in PAGES:
        status, text = fetch(page)
        scripts = re.findall(r'<script[^>]+src="([^"]+)"', text)
        hits = sorted(set(PATTERN.findall(text)))
        print(f"{page} HTTP {status} {len(text)} chars, {len(scripts)} scripts, socket strings {hits}")
        for src in scripts:
            url = urllib.parse.urljoin(page, src)
            if url in seen or "zdassets" in url or "cloudflare" in url:
                continue
            seen.add(url)
            s_status, s_text = fetch(url)
            print(f"  script {url} HTTP {s_status} {len(s_text)} chars, socket strings {sorted(set(PATTERN.findall(s_text)))}")
    for neg in ("https://www.coincorner.com/signalr/negotiate", "https://api.coincorner.com/signalr/negotiate"):
        status, text = fetch(neg)
        print(f"{neg} HTTP {status} {text[:120]!r}")


async def try_upgrade(url: str) -> None:
    try:
        async with websockets.connect(url, open_timeout=10, compression=None, additional_headers=UA) as ws:
            print(f"{url} upgraded, waiting up to 10 s for a frame")
            try:
                msg = await asyncio.wait_for(ws.recv(), 10)
                print(f"  first frame {str(msg)[:200]!r}")
            except asyncio.TimeoutError:
                print("  no frame in 10 s")
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        body = (r.body or b"")[:160].decode("utf-8", "replace")
        print(f"{url} refused: HTTP {r.status_code}, server {r.headers.get('server')}, body {body!r}")
    except Exception as e:  # noqa: BLE001
        print(f"{url} failed: {type(e).__name__}: {e}")


def mode_upgrade() -> None:
    print(f"## upgrade {now()}")
    for url in CANDIDATES:
        asyncio.run(try_upgrade(url))


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    modes = {"scan": mode_scan, "upgrade": mode_upgrade}
    for name in (modes if mode == "all" else [mode]):
        modes[name]()


if __name__ == "__main__":
    import urllib.parse

    main()
