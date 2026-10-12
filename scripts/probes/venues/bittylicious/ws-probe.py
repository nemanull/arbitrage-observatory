# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe looking for any public WebSocket on Bittylicious.

Modes:
  bundle   download the site's one script bundle and count socket markers in it
  dns      resolve the host names a socket would usually live on
  connect  try a WebSocket handshake on a few candidate URLs, each held for at most 5 s
  all      every mode above, in order

Total socket time is well under a minute.
"""

import asyncio
import re
import socket
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

import websockets

UA = "Mozilla/5.0 (survey probe)"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def mode_bundle() -> None:
    print(f"## bundle {now()}")
    status, home = fetch("https://bittylicious.com/")
    scripts = re.findall(r'<script[^>]*src="([^"]+)"', home)
    print(f"home page HTTP {status}, external scripts {scripts}")
    for marker in ("WebSocket", "wss://", "ws://", "socket.io", "EventSource", "/api/v1/"):
        print(f"  home page occurrences of {marker!r}: {home.count(marker)}")
    for src in scripts:
        url = src if src.startswith("http") else f"https://bittylicious.com{src}"
        status, js = fetch(url)
        print(f"{url}: HTTP {status}, {len(js)} characters")
        for marker in ("WebSocket", "wss://", "ws://", "socket.io", "Pusher", "EventSource", "setInterval", "/api/v1/"):
            print(f"  occurrences of {marker!r}: {js.count(marker)}")
        print(f"  /api/v1 paths named in the bundle: {sorted(set(re.findall(r'/api/v1/[A-Za-z]*', js)))}")


def mode_dns() -> None:
    print(f"## dns {now()}")
    for host in ("bittylicious.com", "ws.bittylicious.com", "api.bittylicious.com", "stream.bittylicious.com", "socket.bittylicious.com"):
        try:
            print(f"{host}: {sorted({a[4][0] for a in socket.getaddrinfo(host, 443)})}")
        except socket.gaierror as e:
            print(f"{host}: does not resolve ({e})")


async def try_ws(url: str) -> None:
    try:
        async with websockets.connect(url, open_timeout=8, additional_headers={"User-Agent": UA}) as ws:
            print(f"{url}: handshake accepted")
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
                print(f"  first frame: {str(msg)[:200]}")
            except asyncio.TimeoutError:
                print("  no frame within 5 s")
    except websockets.InvalidStatus as e:
        r = e.response
        print(f"{url}: refused with HTTP {r.status_code}, server {r.headers.get('server')}, body {bytes(r.body or b'')[:80]!r}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {e}")


def mode_connect() -> None:
    print(f"## connect {now()}")
    for url in (
        "wss://bittylicious.com/ws",
        "wss://bittylicious.com/socket.io/?EIO=4&transport=websocket",
        "wss://bittylicious.com/api/v1/ws",
        "wss://ws.bittylicious.com/",
    ):
        asyncio.run(try_ws(url))


MODES = {"bundle": mode_bundle, "dns": mode_dns, "connect": mode_connect}

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name in MODES if arg == "all" else [arg]:
        MODES[name]()
