# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for ChangeNOW.

ChangeNOW documents no WebSocket.
This probe searches the documentation collection and the web front end for socket URLs, then tries one opening handshake on each of a few guessed paths.
Each handshake is closed at once, so sockets are held for a few seconds in total.

Run from the repository root:
    uv run scripts/probes/venues/changenow/ws-probe.py
"""

import asyncio
import json
import re
import urllib.error
import urllib.request
from pathlib import Path

import websockets

ROOT = Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "changenow"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
DOCS = [
    "https://documenter.gw.postman.com/api/collections/8180765/SVfTPnM8?segregateAuth=true&versionTag=latest",
    "https://documenter.gw.postman.com/api/collections/8180765/2sBYAvtpun?segregateAuth=true&versionTag=latest",
]
PAGES = ["https://changenow.io/exchange", "https://changenow.io/crypto-trading", "https://changenow.io/pro"]
GUESSES = [
    "wss://api.changenow.io/ws",
    "wss://api.changenow.io/v2/ws",
    "wss://notifier.changenow.io/",
    "wss://notifier.changenow.io/socket.io/?EIO=4&transport=websocket",
]
SOCKET_URL = re.compile(rb"wss?://[A-Za-z0-9._~:/?#@!$&'()*+,;=%-]+")


def get(url: str) -> tuple[int | None, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:  # recorded, not fatal
        return None, repr(e).encode()


def scan(name: str, body: bytes) -> None:
    urls = sorted({u.decode() for u in SOCKET_URL.findall(body)})
    words = len(re.findall(rb"(?i)websocket", body))
    hosts = sorted({h.decode() for h in re.findall(rb"https://([a-z0-9.-]*changenow\.(?:io|com))", body)})
    print(f"    {name}: {len(body)} B, socket URLs {urls}, 'websocket' occurrences {words}, changenow HTTPS hosts {hosts}")


def walk(items: list, depth: int = 0) -> None:
    for it in items:
        if "item" in it:
            print(f"    {'  ' * depth}# {it['name']}")
            walk(it["item"], depth + 1)
        else:
            r = it.get("request", {})
            u = r.get("url")
            u = u.get("raw") if isinstance(u, dict) else u
            print(f"    {'  ' * depth}- {r.get('method')} {u}")


async def handshake(url: str) -> None:
    try:
        async with websockets.connect(url, user_agent_header=UA, open_timeout=10) as ws:
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=3)
            except asyncio.TimeoutError:
                first = None
            print(f"  {url}: upgraded, first frame {str(first)[:160]!r}")
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        print(f"  {url}: HTTP {r.status_code}, server {r.headers.get('server')}, body {bytes(r.body or b'')[:160]!r}")
    except Exception as e:  # recorded, not fatal
        print(f"  {url}: {type(e).__name__} {e}")


async def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    print("== documentation collections")
    for url in DOCS:
        status, body = get(url)
        print(f"  {status} {url}")
        scan("collection", body)
        if status == 200:
            d = json.loads(body)
            print(f"    collection name {d['info']['name']!r}")
            desc = re.sub(r"<[^>]+>", " ", d["info"].get("description", ""))
            for m in re.finditer(r"Rate limits.{0,120}|To access the ChangeNOW API you need.{0,60}", desc):
                print(f"    intro: {' '.join(m.group(0).split())!r}")
            walk(d.get("item", []))

    print("== front end pages and their first-party scripts")
    for url in PAGES:
        status, body = get(url)
        print(f"  {status} {url}")
        scan("page", body)
        for src in sorted(set(re.findall(rb'src="(/dist/[^"]+\.js)"', body))):
            s, js = get("https://changenow.io" + src.decode())
            scan(src.decode(), js)

    print("== guessed handshakes")
    for url in GUESSES:
        await handshake(url)


if __name__ == "__main__":
    asyncio.run(main())
