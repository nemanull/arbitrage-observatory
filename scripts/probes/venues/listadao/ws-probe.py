# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for ListaDao.

The lista.org web app opens no market data socket.
So this probe lists the wss URLs its bundle holds, and tries a WebSocket handshake once on each likely market data URL of the venue's own hosts.
Each attempt holds a socket for at most five seconds.
Run from the repository root: uv run scripts/probes/venues/listadao/ws-probe.py
"""

import asyncio
import re
import urllib.request
from datetime import datetime, timezone

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
CANDIDATES = [
    "wss://api.lista.org/ws",
    "wss://api.lista.org/",
    "wss://api.lista.org/socket.io/?EIO=4&transport=websocket",
    "wss://lista.org/ws",
    "wss://api.lista.org/api/ws",
]


def bundle_wss() -> None:
    req = urllib.request.Request("https://lista.org/", headers={"User-Agent": UA})
    home = urllib.request.urlopen(req, timeout=20).read().decode()
    src = re.search(r'src="(https://static\.lista\.org/lista-static/assets/index-[^"]+\.js)"', home).group(1)
    js = urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": UA}), timeout=40).read().decode("utf-8", "replace")
    urls = sorted(set(re.findall(r"wss://[A-Za-z0-9._/-]+", js)))
    print(f"bundle {src}: {len(urls)} wss URLs")
    for u in urls:
        host = u.split("/")[2]
        print(f"  {host}{'  (key path trimmed)' if len(u.split('/')) > 3 else ''}")
    print(f"  any wss host under lista.org: {any('lista' in u.split('/')[2] for u in urls)}")


async def try_handshake(url: str) -> None:
    try:
        async with asyncio.timeout(5):
            async with websockets.connect(url, user_agent_header=UA, origin="https://lista.org", open_timeout=5) as ws:
                print(f"{url}: opened")
                try:
                    msg = await asyncio.wait_for(ws.recv(), 2)
                    print(f"  first frame {str(msg)[:120]!r}")
                except TimeoutError:
                    print("  no frame within 2 s")
    except websockets.InvalidStatus as e:
        r = e.response
        print(f"{url}: refused with HTTP {r.status_code} {r.body[:100]!r}")
    except Exception as e:
        print(f"{url}: {type(e).__name__} {str(e)[:120]}")


async def main() -> None:
    print(f"ws-probe start {datetime.now(timezone.utc).isoformat(timespec='seconds')}")
    bundle_wss()
    for url in CANDIDATES:
        await try_handshake(url)
    print(f"ws-probe end {datetime.now(timezone.utc).isoformat(timespec='seconds')}")


if __name__ == "__main__":
    asyncio.run(main())
