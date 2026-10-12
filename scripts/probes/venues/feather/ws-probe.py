# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Feather Exchange (ftrex.io), STOMP over SockJS at /api/market/market-ws.

Modes, all by default, or name some on the command line:
    book     one raw WebSocket for 60 s, STOMP CONNECT, trade-plate for all ten spot pairs, thumb,
             trade for BTC_USDT, and trade-plate for an unknown symbol
    idle     one raw WebSocket, STOMP CONNECT with heart-beat 0,0, no subscription, held up to 150 s
    keepalive  one raw WebSocket, heart-beat 0,0, no subscription, a bare STOMP EOL heartbeat sent every 20 s, held about 100 s
    sockjs   one SockJS framed WebSocket for 10 s, to show the framing the web app uses
Sockets are held about 230 s in total.
Public, unauthenticated and read-only.
The edge refuses a bare "Mozilla/5.0" or a library User-Agent with 403, so a browser User-Agent is sent.
Run from the repository root with: uv run scripts/probes/venues/feather/ws-probe.py
"""

import asyncio
import json
import random
import statistics
import string
import sys
import time
import urllib.request

import websockets

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Origin": "https://ftrex.io"}
RAW_URL = "wss://ftrex.io/api/market/market-ws/websocket"
REST = "https://ftrex.io/api"


def stomp(command, headers=None, body=""):
    lines = [command] + [f"{k}:{v}" for k, v in (headers or {}).items()]
    return "\n".join(lines) + "\n\n" + body + "\x00"


def parse(frame):
    head, _, body = frame.partition("\n\n")
    lines = head.split("\n")
    hdr = dict(line.split(":", 1) for line in lines[1:] if ":" in line)
    return lines[0], hdr, body.rstrip("\x00")


def symbols():
    req = urllib.request.Request(f"{REST}/market/symbol-thumb", data=b"", method="POST", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [row["symbol"] for row in json.load(r)]


def trim(text, n=600):
    return text if len(text) <= n else text[:n] + f" ... ({len(text)} chars)"


async def book_mode():
    print("\n== book: raw WebSocket, 60 s")
    syms = symbols()
    print(f"catalog symbols {len(syms)}: {syms}")
    t_open = time.monotonic()
    async with websockets.connect(RAW_URL, additional_headers=HEADERS, max_size=None) as ws:
        print(f"handshake {ws.response.status_code} in {1000 * (time.monotonic() - t_open):.0f} ms, "
              f"Sec-WebSocket-Extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}, cookies {len(ws.response.headers.get_all('Set-Cookie'))}")
        await ws.send(stomp("CONNECT", {"accept-version": "1.1,1.2", "heart-beat": "10000,10000"}))
        connected = await ws.recv()
        print(f"CONNECTED frame: {connected!r}")
        dests = [f"/topic/market/trade-plate/{s}" for s in syms]
        dests += ["/topic/market/thumb", "/topic/market/trade/BTC_USDT", "/topic/market/trade-plate/FOO_USDT"]
        for i, d in enumerate(dests):
            await ws.send(stomp("SUBSCRIBE", {"id": f"sub-{i}", "destination": d}))
        t0 = time.monotonic()
        stats = {}
        last_side = {}
        first_seen = {}
        msg_ids = []
        other = []
        samples = {}
        while time.monotonic() - t0 < 60:
            try:
                raw = await asyncio.wait_for(ws.recv(), 5)
            except asyncio.TimeoutError:
                print(f"  silence of 5 s at {time.monotonic() - t0:.1f} s")
                continue
            now = time.monotonic() - t0
            if raw in ("\n", "\r\n"):
                stats.setdefault("heartbeat", []).append(now)
                continue
            cmd, hdr, body = parse(raw)
            if cmd != "MESSAGE":
                other.append((round(now, 2), cmd, hdr, body))
                continue
            dest = hdr.get("destination", "")
            msg_ids.append(hdr.get("message-id", ""))
            data = json.loads(body)
            if "/trade-plate/" in dest:
                key = (data.get("symbol"), data.get("direction"))
                rec = stats.setdefault(key, {"t": [], "n": [], "order_ok": 0, "order_bad": 0, "same": 0, "keys": set()})
                rec["t"].append(now)
                items = data.get("items", [])
                rec["n"].append(len(items))
                rec["keys"].update(data.keys())
                prices = [it["price"] for it in items]
                want = sorted(prices, reverse=(data.get("direction") == "BUY"))
                rec["order_ok" if prices == want else "order_bad"] += 1
                if last_side.get(key) == items:
                    rec["same"] += 1
                last_side[key] = items
                first_seen.setdefault(key, round(now, 3))
                samples.setdefault(key, body)
            else:
                stats.setdefault(dest, {"t": [], "n": [], "order_ok": 0, "order_bad": 0, "same": 0, "keys": set()})
                stats[dest]["t"].append(now)
                stats[dest]["keys"].update(data.keys() if isinstance(data, dict) else ["<list>"])
                samples.setdefault(dest, body)
        print(f"non MESSAGE frames: {other}")
        print(f"heartbeats from server: {len(stats.get('heartbeat', []))}")
        for key, rec in stats.items():
            if key == "heartbeat":
                continue
            gaps = [b - a for a, b in zip(rec["t"], rec["t"][1:])]
            g = f"median gap {statistics.median(gaps):.3f} s, min {min(gaps):.3f}, max {max(gaps):.3f}" if gaps else "no gaps"
            n = f"items min {min(rec['n'])} max {max(rec['n'])}" if rec["n"] else ""
            print(f"  {key}: {len(rec['t'])} msgs, first at {rec['t'][0]:.3f} s, {g}, {n}, order ok {rec['order_ok']} bad {rec['order_bad']}, identical repeats {rec['same']}, fields {sorted(rec['keys'])}")
        counters = [int(m.rsplit("-", 1)[1]) for m in msg_ids if m.rsplit("-", 1)[-1].isdigit()]
        steps = [b - a for a, b in zip(counters, counters[1:])]
        print(f"message-id samples {msg_ids[:3]}, counter steps min {min(steps)} max {max(steps)} over {len(steps)} steps")
        bids = json.loads(samples.get(("BTC_USDT", "BUY"), "{}")).get("items", [])
        asks = json.loads(samples.get(("BTC_USDT", "SELL"), "{}")).get("items", [])
        if bids and asks:
            print(f"BTC_USDT first frames: best bid {bids[0]}, best ask {asks[0]}, crossed {bids[0]['price'] >= asks[0]['price']}")
        print("\nsample BTC_USDT SELL frame:\n" + trim(samples.get(("BTC_USDT", "SELL"), ""), 900))
        print("\nsample thumb frame:\n" + trim(samples.get("/topic/market/thumb", "<none>")))
        print("\nsample trade frame:\n" + trim(samples.get("/topic/market/trade/BTC_USDT", "<none>")))
        print(f"\nFOO_USDT frames: {[k for k in stats if isinstance(k, tuple) and k[0] == 'FOO_USDT']}")
        await ws.send(stomp("DISCONNECT", {"receipt": "bye"}))
        try:
            print(f"DISCONNECT answer: {await asyncio.wait_for(ws.recv(), 3)!r}")
        except Exception as e:  # noqa: BLE001
            print(f"DISCONNECT answer: {type(e).__name__} {e}")


async def idle_mode():
    print("\n== idle: raw WebSocket, heart-beat 0,0, no subscription, up to 150 s")
    async with websockets.connect(RAW_URL, additional_headers=HEADERS, max_size=None, ping_interval=None) as ws:
        await ws.send(stomp("CONNECT", {"accept-version": "1.1,1.2", "heart-beat": "0,0"}))
        print(f"CONNECTED frame: {await ws.recv()!r}")
        t0 = time.monotonic()
        try:
            while time.monotonic() - t0 < 150:
                raw = await asyncio.wait_for(ws.recv(), 150 - (time.monotonic() - t0))
                print(f"  {time.monotonic() - t0:.1f} s frame {raw!r}")
        except asyncio.TimeoutError:
            print(f"still open after {time.monotonic() - t0:.0f} s of silence in both directions")
        except websockets.ConnectionClosed as e:
            print(f"closed after {time.monotonic() - t0:.1f} s: code {e.code} reason {e.reason!r}")


async def keepalive_mode():
    print("\n== keepalive: raw WebSocket, heart-beat 0,0, no subscription, EOL sent every 20 s, about 100 s")
    async with websockets.connect(RAW_URL, additional_headers=HEADERS, max_size=None, ping_interval=None) as ws:
        await ws.send(stomp("CONNECT", {"accept-version": "1.1,1.2", "heart-beat": "0,0"}))
        print(f"CONNECTED frame: {await ws.recv()!r}")
        t0 = time.monotonic()
        try:
            while time.monotonic() - t0 < 90:
                await ws.send("\n")
                try:
                    raw = await asyncio.wait_for(ws.recv(), 20)
                    print(f"  {time.monotonic() - t0:.1f} s frame {raw!r}")
                except asyncio.TimeoutError:
                    pass
            print(f"still open after {time.monotonic() - t0:.0f} s with an EOL every 20 s")
        except websockets.ConnectionClosed as e:
            print(f"closed after {time.monotonic() - t0:.1f} s: code {e.code} reason {e.reason!r}")


async def sockjs_mode():
    print("\n== sockjs: framed WebSocket, 10 s")
    server = f"{random.randint(0, 999):03d}"
    session = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    url = f"wss://ftrex.io/api/market/market-ws/{server}/{session}/websocket"
    async with websockets.connect(url, additional_headers=HEADERS, max_size=None) as ws:
        print(f"url {url}, handshake {ws.response.status_code}")
        print(f"open frame {await ws.recv()!r}")
        await ws.send(json.dumps([stomp("CONNECT", {"accept-version": "1.1,1.2", "heart-beat": "10000,10000"})]))
        await ws.send(json.dumps([stomp("SUBSCRIBE", {"id": "sub-0", "destination": "/topic/market/trade-plate/BTC_USDT"})]))
        t0 = time.monotonic()
        kinds = {}
        while time.monotonic() - t0 < 10:
            raw = await asyncio.wait_for(ws.recv(), 30)
            kinds[raw[:1]] = kinds.get(raw[:1], 0) + 1
            if kinds[raw[:1]] <= 2:
                print(f"  {time.monotonic() - t0:.2f} s {trim(raw, 200)!r}")
        print(f"frame kinds by first char: {kinds}")


async def main():
    modes = sys.argv[1:] or ["book", "idle", "keepalive", "sockjs"]
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    for m in modes:
        await {"book": book_mode, "idle": idle_mode, "keepalive": keepalive_mode, "sockjs": sockjs_mode}[m]()


asyncio.run(main())
