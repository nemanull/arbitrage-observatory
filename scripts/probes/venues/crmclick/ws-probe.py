# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""CRMClick WebSocket probe for docs/profiles/crmclick/websocket.md.

Public, unauthenticated and read-only.
The only socket CRMClick runs itself is wss://wss2.crmclick.io, which the crmclick.io web app opens for its own matched spot markets.
Its perpetuals page opens HTX's wss://api.hbdm.com/linear-swap-ws instead, so part F opens that URL briefly for comparison.
It holds sockets for about 2.5 minutes of wall time, one at a time:
  A. server.ping and server.time, the keepalive the web app sends every 12 s.
  B. depth.subscribe on ARCBUSDT, a matched market, with the web app's params [market, 30, "0.00000001"], for 45 s.
  C. depth.subscribe on BTCUSDT, an HTX-routed spot market, and on BTCUSDT and BTC-USDT as perpetual names, 15 s each.
  D. depth.subscribe on an unknown market, and an unknown method, for the error shapes.
  E. 40 s with no pings, to see whether the server closes an idle socket.
  F. 8 s of market.BTC-USDT.depth.step0 on HTX's linear swap socket, gzip frames, answering its ping.
Run from the repository root with: uv run scripts/probes/venues/crmclick/ws-probe.py
Captured frames go to .claude/survey-work/crmclick/ws-capture.jsonl.
"""

import asyncio
import gzip
import json
import pathlib
import time

import websockets

URL = "wss://wss2.crmclick.io"
HTX_URL = "wss://api.hbdm.com/linear-swap-ws"
CAPTURE = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "crmclick" / "ws-capture.jsonl"


def log(part: str, direction: str, frame: str):
    with CAPTURE.open("a") as fh:
        fh.write(json.dumps({"t": round(time.time(), 3), "part": part, "dir": direction, "frame": frame[:3000]}) + "\n")


async def send(ws, part: str, obj: dict):
    text = json.dumps(obj)
    log(part, "out", text)
    await ws.send(text)


async def collect(ws, part: str, seconds: float, ping_every: float | None = 12.0):
    """Read frames for `seconds`, pinging like the web app does. Returns parsed frames with arrival times."""
    frames = []
    end = time.monotonic() + seconds
    next_ping = time.monotonic() + ping_every if ping_every else None
    while True:
        now = time.monotonic()
        if now >= end:
            break
        wait = end - now
        if next_ping:
            wait = min(wait, max(0.0, next_ping - now))
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=wait)
        except asyncio.TimeoutError:
            if next_ping and time.monotonic() >= next_ping:
                await send(ws, part, {"id": 900, "method": "server.ping", "params": []})
                next_ping = time.monotonic() + ping_every
            continue
        except websockets.ConnectionClosed as exc:
            frames.append((time.monotonic(), {"closed": True, "code": exc.rcvd.code if exc.rcvd else None, "reason": exc.rcvd.reason if exc.rcvd else None}))
            break
        text = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
        log(part, "in", text)
        try:
            frames.append((time.monotonic(), json.loads(text)))
        except json.JSONDecodeError:
            frames.append((time.monotonic(), {"raw": text[:200]}))
    return frames


def describe_depth(frames, t0):
    updates = [(t, f) for t, f in frames if f.get("method") == "depth.update"]
    print(f"    depth.update frames: {len(updates)}")
    for i, (t, f) in enumerate(updates[:3] + updates[-1:] if len(updates) > 3 else updates):
        p = f.get("params", [])
        full = p[0] if p else None
        body = p[1] if len(p) > 1 else {}
        asks = body.get("asks", []) if isinstance(body, dict) else []
        bids = body.get("bids", []) if isinstance(body, dict) else []
        extra = sorted(k for k in body.keys() if k not in ("asks", "bids")) if isinstance(body, dict) else []
        print(f"    +{t - t0:5.1f}s full={full} market={p[2] if len(p) > 2 else None} asks={len(asks)} bids={len(bids)} other_keys={extra} best_ask={asks[:1]} best_bid={bids[:1]}")
    gaps = [round(b[0] - a[0], 2) for a, b in zip(updates, updates[1:])]
    if gaps:
        print(f"    gaps between depth.update frames, s: min {min(gaps)} max {max(gaps)}")
    return updates


async def main():
    CAPTURE.parent.mkdir(parents=True, exist_ok=True)
    CAPTURE.write_text("")
    t_open = time.monotonic()
    async with websockets.connect(URL, open_timeout=15, ping_interval=None, max_size=2**23, compression="deflate") as ws:
        print(f"connected to {URL} in {time.monotonic() - t_open:.2f}s")
        ext = ws.response.headers.get("Sec-WebSocket-Extensions") if ws.response else None
        print(f"  negotiated extensions: {ext!r}")
        print(f"  response headers: {list(ws.response.headers.raw_items()) if ws.response else None}")

        print("A. server.ping and server.time")
        await send(ws, "A", {"id": 1, "method": "server.ping", "params": []})
        await send(ws, "A", {"id": 2, "method": "server.time", "params": []})
        for t, f in await collect(ws, "A", 3, None):
            print(f"    {json.dumps(f)[:200]}")

        print("B. depth.subscribe ARCBUSDT [market, 30, 0.00000001], 45 s")
        t0 = time.monotonic()
        await send(ws, "B", {"id": 4, "method": "depth.subscribe", "params": ["ARCBUSDT", 30, "0.00000001"]})
        frames = await collect(ws, "B", 45)
        for t, f in frames:
            if f.get("id") == 4:
                print(f"    ack +{t - t0:.2f}s {json.dumps(f)[:200]}")
        ups = describe_depth(frames, t0)
        if ups:
            first = ups[0][1]["params"]
            print(f"    first frame full={first[0]}, level shape {json.dumps(first[1].get('asks', [])[:2])}")
            partial = [f for _, f in ups if f["params"][0] is False]
            print(f"    frames with full=false: {len(partial)}")
            if partial:
                print(f"    example delta: {json.dumps(partial[0]['params'])[:400]}")
        await send(ws, "B", {"id": 44, "method": "depth.unsubscribe", "params": []})
        for t, f in await collect(ws, "B", 2, None):
            if f.get("id") == 44:
                print(f"    unsubscribe ack {json.dumps(f)[:200]}")

        print("C. depth.subscribe on HTX-routed and perpetual names, 15 s each")
        for i, name in enumerate(["BTCUSDT", "BTC-USDT", "btcusdt"]):
            t0 = time.monotonic()
            await send(ws, "C", {"id": 50 + i, "method": "depth.subscribe", "params": [name, 30, "0.00000001"]})
            frames = await collect(ws, "C", 15)
            for t, f in frames:
                if f.get("id") == 50 + i:
                    print(f"    {name}: ack {json.dumps(f)[:200]}")
            print(f"    {name}:", end="")
            describe_depth(frames, t0)
            await send(ws, "C", {"id": 60 + i, "method": "depth.unsubscribe", "params": []})
            await collect(ws, "C", 1, None)

        print("D. error shapes")
        await send(ws, "D", {"id": 70, "method": "depth.subscribe", "params": ["NOSUCHUSDT", 30, "0.00000001"]})
        await send(ws, "D", {"id": 71, "method": "no.such.method", "params": []})
        await send(ws, "D", {"id": 72, "method": "depth.query", "params": ["ARCBUSDT", 5, "0.00000001"]})
        for t, f in await collect(ws, "D", 4, None):
            if f.get("method") != "depth.update":
                print(f"    {json.dumps(f)[:300]}")

        print("E. 40 s with no pings and no subscriptions")
        t0 = time.monotonic()
        frames = await collect(ws, "E", 40, None)
        closed = [f for _, f in frames if f.get("closed")]
        print(f"    frames received: {len(frames)}, closed: {closed[0] if closed else 'no'} after {time.monotonic() - t0:.1f}s")
        if not closed:
            await send(ws, "E", {"id": 80, "method": "server.ping", "params": []})
            for t, f in await collect(ws, "E", 3, None):
                print(f"    ping after idle: {json.dumps(f)[:200]}")

    print("F. HTX linear swap market.BTC-USDT.depth.step0, 8 s")
    async with websockets.connect(HTX_URL, open_timeout=15, ping_interval=None, max_size=2**23) as hws:
        await hws.send(json.dumps({"sub": "market.BTC-USDT.depth.step0", "id": "crm-compare"}))
        end = time.monotonic() + 8
        n = 0
        while time.monotonic() < end:
            try:
                raw = await asyncio.wait_for(hws.recv(), timeout=end - time.monotonic())
            except asyncio.TimeoutError:
                break
            msg = json.loads(gzip.decompress(raw))
            if "ping" in msg:
                await hws.send(json.dumps({"pong": msg["ping"]}))
                continue
            log("F", "in", json.dumps(msg))
            if "tick" in msg:
                n += 1
                if n == 1:
                    tk = msg["tick"]
                    print(f"    first tick: ch={msg['ch']} mrid={tk.get('mrid')} version={tk.get('version')} best_bid={tk['bids'][:1]} best_ask={tk['asks'][:1]} levels={len(tk['bids'])}/{len(tk['asks'])}")
            else:
                print(f"    {json.dumps(msg)[:200]}")
        print(f"    depth ticks in 8 s: {n}")


if __name__ == "__main__":
    asyncio.run(main())
