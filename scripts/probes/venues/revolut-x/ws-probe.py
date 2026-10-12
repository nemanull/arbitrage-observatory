# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only probe for a public WebSocket on Revolut X, which documents none.

Sections, all by default, or name some on the command line:
    docs       fetch the official API reference page and the official LLM reference from the Revolut X GitHub repository,
               and count the words websocket, wss:// and stream in each.
    ccxt       fetch CCXT master's revolutx class and its Revolut X comparison page,
               and report whether a pro (WebSocket) class exists and what the page says about streaming.
    handshake  one WebSocket opening handshake per candidate URL on the API host and the web app host, closed at once.
               No subscription is sent, so total socket time is a few seconds.

Run from the repository root:
    uv run scripts/probes/venues/revolut-x/ws-probe.py [section ...]
"""

import asyncio
import json
import re
import sys
import time
import urllib.error
import urllib.request

import websockets

DOCS = "https://developer.revolut.com/docs/api/revolut-x-crypto-exchange"
LLM_DOC = "https://raw.githubusercontent.com/revolut-engineering/revolut-x-api/master/revolut-x-api-for-llm.md"
CCXT_CLASS = "https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/revolutx.ts"
CCXT_PRO = "https://raw.githubusercontent.com/ccxt/ccxt/master/ts/src/pro/revolutx.ts"
CCXT_CMP = "https://raw.githubusercontent.com/ccxt/ccxt/master/wiki/comparisons/ccxt-vs-revolutx-api.md"
CANDIDATES = [
    "wss://revx.revolut.com/ws",
    "wss://revx.revolut.com/api/ws",
    "wss://revx.revolut.com/api/1.0/ws",
    "wss://revx.revolut.com/api/2.0/ws",
    "wss://revx.revolut.com/api/1.0/public/ws",
    "wss://revx.revolut.com/stream",
    "wss://exchange.revolut.com/ws",
]


def out(section: str, **kw) -> None:
    print(json.dumps({"section": section, **kw}, ensure_ascii=False, default=str), flush=True)


def fetch(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


def counts(text: str) -> dict:
    low = text.lower()
    return {"websocket": low.count("websocket"), "wss://": low.count("wss://"), "stream": len(re.findall(r"\bstream", low))}


def section_docs() -> None:
    for url in (DOCS, LLM_DOC):
        status, text = fetch(url)
        out("docs", url=url, status=status, bytes=len(text), counts=counts(text),
            public_paths=sorted(set(re.findall(r"/[12]\.0/public/[a-z/{}-]+", text))))
        time.sleep(1)


def section_ccxt() -> None:
    status, text = fetch(CCXT_CLASS)
    has = {k: re.search(rf"'{k}':\s*(\w+)", text).group(1) for k in ("spot", "swap", "future", "ws") if re.search(rf"'{k}':\s*(\w+)", text)}
    out("ccxt", url=CCXT_CLASS, status=status, lines=text.count("\n") + 1, has=has,
        mentions_wss=text.count("wss://"))
    status, _ = fetch(CCXT_PRO)
    out("ccxt", url=CCXT_PRO, status=status)
    status, text = fetch(CCXT_CMP)
    lines = [ln.strip() for ln in text.splitlines() if re.search(r"websocket|stream", ln, re.I)]
    out("ccxt", url=CCXT_CMP, status=status, streaming_lines=lines[:6])


async def one_handshake(url: str) -> dict:
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10, user_agent_header="arbitrage-observatory-probe/1.0") as ws:
            ms = round((time.perf_counter() - t0) * 1000)
            try:
                first = await asyncio.wait_for(ws.recv(), timeout=3)
            except asyncio.TimeoutError:
                first = None
            return {"url": url, "opened": True, "ms": ms, "first_frame": str(first)[:300] if first else None}
    except websockets.exceptions.InvalidStatus as e:
        resp = e.response
        body = (resp.body or b"")[:300].decode(errors="replace")
        hdr = {k: v for k, v in resp.headers.raw_items() if k.lower() in ("server", "content-type", "cf-mitigated", "via")}
        return {"url": url, "opened": False, "status": resp.status_code, "headers": hdr, "body": body}
    except Exception as e:  # noqa: BLE001, the probe records whatever refused the handshake
        return {"url": url, "opened": False, "error": f"{type(e).__name__}: {e}"[:300]}


async def section_handshake() -> None:
    for url in CANDIDATES:
        out("handshake", **await one_handshake(url))
        await asyncio.sleep(1.5)


if __name__ == "__main__":
    names = sys.argv[1:] or ["docs", "ccxt", "handshake"]
    out("start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), sections=names)
    for n in names:
        if n == "docs":
            section_docs()
        elif n == "ccxt":
            section_ccxt()
        elif n == "handshake":
            asyncio.run(section_handshake())
