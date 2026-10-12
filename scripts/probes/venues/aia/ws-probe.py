# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""AIA Exchange WebSocket probe for docs/profiles/aia/websocket.md.

Public, unauthenticated and read-only, eight handshakes and at most 30 s of socket time.
  1. A plain GET of the socket path, which reaches the socket server without an upgrade.
  2. A WebSocket handshake to every URL the live bundle can pick: the tenant config's ws and oldws,
     and the page's own origin, which the bundle reaches through its localStorage "ws" override.
  3. On any socket that opens, the subscribe frames the bundle sends for the BTC perpetual book,
     index, funding and trades, with replies inflated as the bundle inflates them.
Run from the repository root with: uv run scripts/probes/venues/aia/ws-probe.py
"""

import asyncio
import json
import re
import time
import urllib.error
import urllib.request
import zlib

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36"
ORIGIN = "https://aianalysisexchange.com"
EX_ID = "expf"  # the tenant config's exId, see rest-probe.py section 3
URLS = [
    "wss://www.cryptoex.aianalysis.co.uk/v1/np/ws",  # config ws
    "wss://www.cryptoex.aianalysis.co.uk",  # config oldws
    "wss://aianalysisexchange.com/v1/np/ws",
    "wss://www.aianalysisexchange.com/v1/np/ws",
    "wss://aianalysisexchange.com/v1/pusher/ws",
    "wss://ws.aianalysisexchange.com/v1/np/ws",
]
SUBS = [
    f"market_{EX_ID}.btcusdt_depth_step0",
    "market_btcusdt_index_price",
    f"market_{EX_ID}.btcusdt_funding_rate",
    f"market_{EX_ID}.btcusdt_trade_ticker",
]


def text_of(body):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", body.decode("utf-8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", t)).strip()


def plain_get():
    print("== 1. Plain GET of the socket path")
    for url in ("https://www.aianalysisexchange.com/v1/np/ws", "https://aianalysisexchange.com/v1/np/ws"):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                st, hd, body = r.status, dict(r.headers), r.read()
        except urllib.error.HTTPError as e:
            st, hd, body = e.code, dict(e.headers), e.read()
        except Exception as e:
            st, hd, body = None, {}, f"{type(e).__name__}: {e}".encode()
        keep = {k: v for k, v in hd.items() if k.lower() in ("sec-websocket-version", "x-envoy-upstream-service-time", "x-via", "content-type")}
        print(f"{url}: {st} {keep} body={body[:60]!r}")


def inflate(m):
    if isinstance(m, str):
        return m
    for wbits in (15, -15, 31):
        try:
            return zlib.decompress(m, wbits).decode("utf-8", "replace")
        except zlib.error:
            pass
    return "undecoded " + m[:40].hex()


async def try_url(url, budget):
    t0 = time.perf_counter()
    try:
        async with websockets.connect(url, compression=None, open_timeout=15, user_agent_header=UA,
                                      origin=ORIGIN, max_size=None) as ws:
            print(f"{url}: OPEN in {(time.perf_counter() - t0) * 1000:.0f} ms, extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}")
            for ch in SUBS:
                await ws.send(json.dumps({"event": "sub", "params": {"channel": ch, "cb_id": "10001001"}}))
            end = time.time() + budget
            n = 0
            while time.time() < end and n < 40:
                try:
                    m = await asyncio.wait_for(ws.recv(), end - time.time())
                except asyncio.TimeoutError:
                    break
                n += 1
                t = inflate(m)
                print(f"  frame {n} {'binary' if isinstance(m, bytes) else 'text'} {len(m)} bytes: {t[:300]}")
                if '"ping"' in t:
                    await ws.send(json.dumps({"pong": json.loads(t)["ping"]}))
            return True
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        hd = {k: v for k, v in r.headers.raw_items() if k.lower() in ("x-via", "x-ws-request-id", "server", "content-type", "content-length")}
        msg = text_of(r.body or b"")
        i = msg.find("The following error")
        print(f"{url}: HTTP {r.status_code} in {(time.perf_counter() - t0) * 1000:.0f} ms {hd}")
        print(f"  body text: {msg[i:i + 220] if i >= 0 else msg[:220]}")
    except Exception as e:
        print(f"{url}: {type(e).__name__}: {str(e)[:200]} after {(time.perf_counter() - t0) * 1000:.0f} ms")
    return False


async def main():
    plain_get()
    print("== 2. WebSocket handshakes")
    for url in URLS:
        if await try_url(url, 30):
            break


asyncio.run(main())
