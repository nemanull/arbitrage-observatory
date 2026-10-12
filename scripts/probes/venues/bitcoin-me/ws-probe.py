# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only streaming probe for Bitcoin.me, formerly Klever Exchange.

The legacy CEX web app streams its book over gRPC-web from events.exchange.klever.io, not over a WebSocket.
This probe scans the web bundle and its lazy chunks for socket URLs and gRPC methods,
calls the public stream methods once each for at most ten seconds,
and tries one WebSocket upgrade on the events host.
Run from the repository root: uv run scripts/probes/venues/bitcoin-me/ws-probe.py
Captures go to .claude/survey-work/bitcoin-me/ws-probe.json.
"""

import asyncio
import base64
import json
import re
import struct
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websockets

WORK = Path(".claude/survey-work/bitcoin-me")
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
CURL_UA = "curl/8.14.1"
CEX = "https://cex.bitcoin.me"
EVENTS = "https://events.exchange.klever.io"
KLV_USDT = 1  # keypair ID of KLV-USDT in manager.exchange.klever.io/v1/keypairs


def get(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": BROWSER_UA}), timeout=30) as reply:
        return reply.read()


def varint_field(number: int, value: int) -> bytes:
    out, key = b"", (number << 3) | 0
    for v in (key, value):
        while True:
            byte = v & 0x7F
            v >>= 7
            out += bytes([byte | (0x80 if v else 0)])
            if not v:
                break
    return out


def grpc_web_text(message: bytes) -> bytes:
    return base64.b64encode(b"\x00" + struct.pack(">I", len(message)) + message)


def scan_bundle() -> dict:
    html = get(CEX + "/").decode()
    main = re.search(r'src="(/static/js/main\.[0-9a-f]+\.js)"', html).group(1)
    text = get(CEX + main).decode("utf-8", "replace")
    chunk_map = re.search(r'static/js/"\+e\+"\."\+\{([^}]*)\}', text).group(1)
    chunks = re.findall(r'(\d+):"([0-9a-f]+)"', chunk_map)
    texts = {main: text}
    for number, digest in chunks:
        path = f"/static/js/{number}.{digest}.chunk.js"
        texts[path] = get(CEX + path).decode("utf-8", "replace")
        time.sleep(0.1)
    joined = "\n".join(texts.values())
    return {
        "main": main,
        "files_scanned": len(texts),
        "ws_urls": sorted(set(re.findall(r"wss?://[A-Za-z0-9.\-/_]+", joined))),
        "websocket_constructor_count": len(re.findall(r"new WebSocket\(", joined)),
        "grpc_methods": sorted(set(re.findall(r'"(/events\.EventsService/[A-Za-z]+)"', joined))),
        "grpc_clients": sorted(set(re.findall(r'new [A-Za-z]\.([A-Za-z]+ServiceClient)\("([^"]+)"\)', joined))),
        "order_group_defaults": re.search(r'key:"subscribeOrderGroups".{0,320}', joined).group(0)[:320],
    }


def call_stream(method: str, message: bytes, referer: bool, seconds: float = 10) -> dict:
    headers = {
        "User-Agent": CURL_UA,
        "Content-Type": "application/grpc-web-text",
        "Accept": "application/grpc-web-text",
        "X-Grpc-Web": "1",
        "ClientOrigin": "3",
    }
    if referer:
        headers["Referer"] = CEX + "/"
        headers["Origin"] = CEX
    req = urllib.request.Request(f"{EVENTS}/events.EventsService/{method}", data=grpc_web_text(message), headers=headers, method="POST")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=seconds) as reply:
            status, ctype, body = reply.status, reply.headers.get("Content-Type"), reply.read(4096)
    except urllib.error.HTTPError as err:
        status, ctype, body = err.code, err.headers.get("Content-Type"), err.read(4096)
    except TimeoutError:
        status, ctype, body = "timeout", None, b""
    text = body.decode("utf-8", "replace")
    title = re.search(r"<title>([^<]*)</title>", text)
    return {
        "method": method,
        "referer": referer,
        "status": status,
        "content_type": ctype,
        "ms": round((time.perf_counter() - start) * 1000),
        "title": title.group(1).strip() if title else None,
        "head": None if title else text[:200],
    }


async def try_websocket(url: str) -> dict:
    start = time.perf_counter()
    try:
        async with websockets.connect(url, open_timeout=10, user_agent_header=BROWSER_UA, additional_headers={"Origin": CEX}) as ws:
            return {"url": url, "result": "open", "ms": round((time.perf_counter() - start) * 1000)}
    except websockets.exceptions.InvalidStatus as err:
        return {"url": url, "result": f"HTTP {err.response.status_code}", "body": err.response.body[:160].decode("utf-8", "replace") if err.response.body else None}
    except Exception as err:  # the probe records whatever the upgrade did
        return {"url": url, "result": f"{type(err).__name__}: {err}"[:200]}


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    out: dict = {"started": datetime.now(timezone.utc).isoformat()}

    out["bundle"] = scan_bundle()
    print("bundle", json.dumps({k: v for k, v in out["bundle"].items() if k != "order_group_defaults"}, indent=1))

    order_groups = varint_field(1, KLV_USDT) + varint_field(2, 6) + varint_field(3, 20)  # keypairId, decimals, limit
    tickers = varint_field(1, KLV_USDT)  # ConnectStreamTicker keypairId
    out["streams"] = []
    for method, message in [("HealthCheck", b""), ("SubscribeOrderGroups", order_groups), ("SubscribeTickers", tickers)]:
        for referer in (False, True):
            result = call_stream(method, message, referer)
            out["streams"].append(result)
            print("stream", result)
            time.sleep(1)

    out["websocket"] = [asyncio.run(try_websocket(url)) for url in ["wss://events.exchange.klever.io/", "wss://api.exchange.bitcoin.me/"]]
    for result in out["websocket"]:
        print("websocket", result)

    (WORK / "ws-probe.json").write_text(json.dumps(out, indent=1))
    print("wrote", WORK / "ws-probe.json")


if __name__ == "__main__":
    main()
