# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""CoinLion SignalR market data probe for docs/profiles/coinlion/websocket.md.

Public, unauthenticated and read-only.
It opens two sockets to the ASP.NET Core SignalR hub at ursa.coinlion.com/marketdata/info, the hub the web app streams from.
Socket A sends client pings and holds six streams for 150 s.
Socket B opens at the same time, subscribes to nothing, never pings, and waits up to 75 s for the server to close it.
Total socket time is under four minutes.
Run from the repository root with: uv run scripts/probes/venues/coinlion/ws-probe.py
"""

import asyncio
import collections
import json
import time
import urllib.request

import websockets

HUB = "https://ursa.coinlion.com/marketdata/info"
RS = "\x1e"  # SignalR JSON record separator
HOLD_A = 150
HOLD_B = 75


def negotiate():
    req = urllib.request.Request(f"{HUB}/negotiate?negotiateVersion=1", data=b"", method="POST", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=30) as r:
        body = json.load(r)
    print("negotiate ms", round((time.perf_counter() - t0) * 1000), "transports", [t["transport"] for t in body["availableTransports"]])
    return body["connectionToken"]


def reader(ws):
    """Drain the socket into a queue, because cancelling ws.recv() mid-message breaks websockets' frame buffer."""
    q = asyncio.Queue()

    async def run():
        try:
            async for msg in ws:
                await q.put(msg)
        except websockets.ConnectionClosed as e:
            await q.put(e)
        else:
            await q.put(websockets.ConnectionClosedOK(ws.close_rcvd, ws.close_sent))

    task = asyncio.create_task(run())
    return q, task


async def next_msg(q, timeout):
    """Return the next text message, None on timeout, and raise when the socket closed."""
    try:
        m = await asyncio.wait_for(q.get(), timeout)
    except asyncio.TimeoutError:
        return None
    if isinstance(m, Exception):
        raise m
    return m


def trim(s, n=300):
    return s if len(s) <= n else s[:n] + f"... ({len(s)} chars)"


async def socket_a():
    tok = negotiate()
    url = f"wss://ursa.coinlion.com/marketdata/info?id={tok}"
    t0 = time.perf_counter()
    async with websockets.connect(url, max_size=None, ping_interval=None, compression=None) as ws:
        print("A open ms", round((time.perf_counter() - t0) * 1000), "extensions", ws.response.headers.get("Sec-WebSocket-Extensions"))
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
        print("A handshake reply", repr(await ws.recv()))
        q, task = reader(ws)
        streams = {
            "0": ("MiniTicker", ["3"]),
            "1": ("Book", ["lion_usdc"]),
            "2": ("Book", ["btc_usd"]),
            "3": ("Book", ["sol_usd"]),
            "4": ("Trades", ["sol_usd"]),
            "5": ("Book", ["nope_xyz"]),
            "6": ("Book", []),
            "7": ("Depth", ["sol_usd"]),
        }
        sent = {}
        for inv, (target, args) in streams.items():
            frame = {"type": 4, "invocationId": inv, "target": target, "arguments": args, "streamIds": []}
            if inv in ("0", "1", "5"):
                print("A send", json.dumps(frame))
            await ws.send(json.dumps(frame) + RS)
            sent[inv] = time.perf_counter()
        per_inv = collections.defaultdict(list)
        pings_in = []
        last_ping_out = time.perf_counter()
        first_shown = set()
        start = time.perf_counter()
        while time.perf_counter() - start < HOLD_A:
            if time.perf_counter() - last_ping_out >= 15:
                await ws.send(json.dumps({"type": 6}) + RS)
                last_ping_out = time.perf_counter()
            msg = await next_msg(q, 1)
            if msg is None:
                continue
            now = time.perf_counter()
            for part in msg.split(RS):
                if not part:
                    continue
                m = json.loads(part)
                t = m.get("type")
                if t == 6:
                    pings_in.append(round(now - start, 1))
                    continue
                inv = m.get("invocationId")
                per_inv[inv].append((round(now - start, 2), m))
                if inv not in first_shown:
                    first_shown.add(inv)
                    print(f"A first frame inv {inv} {streams.get(inv, ('?',))[0]} after ms", round((now - sent.get(inv, start)) * 1000), trim(part))
        print("A server pings at s", pings_in)
        for inv, rows in sorted(per_inv.items()):
            target, args = streams[inv]
            types = collections.Counter(m["type"] for _, m in rows)
            print(f"A inv {inv} {target} {args} frames", len(rows), "types", dict(types))
            items = [m["item"] for _, m in rows if m["type"] == 2]
            if target == "Book" and items:
                b = items[0]
                print("   book keys", sorted(b), "bids", len(b["bids"]), "asks", len(b["asks"]), "version", b["version"], "snapshot", b["snapshot"])
                print("   versions", [x["version"] for x in items], "snapshots", [x["snapshot"] for x in items])
                if len(b["asks"]) > 1:
                    pr = [x["price"] for x in b["asks"]]
                    print("   asks ascending", pr == sorted(pr), "first", pr[:3], "last", pr[-3:])
                if b["bids"]:
                    print("   bids", [(x["price"], x["amount"]) for x in b["bids"]])
            if target == "Trades" and items:
                tr = items[0]
                print("   trades in first frame", len(tr), "keys", sorted(tr[0]) if tr else None, "newest", tr[0] if tr else None, "oldest", tr[-1]["tradeTime"] if tr else None)
                print("   sum of amounts", round(sum(x["amount"] for x in tr), 4), "sides", dict(collections.Counter(x["side"] for x in tr)), "distinct prices", len({x["executionPrice"] for x in tr}))
                print("   later frames", [len(x) for x in items[1:]])
            if target == "MiniTicker" and items:
                gaps = [round(b - a, 2) for (a, _), (b, _) in zip(rows, rows[1:])]
                print("   frames", len(items), "rows per frame", len(items[0]), "keys", sorted(items[0][0]))
                print("   gap s median", sorted(gaps)[len(gaps) // 2] if gaps else None, "min", min(gaps) if gaps else None, "max", max(gaps) if gaps else None)
                live = [r for r in items[-1] if r["volume"]]
                print("   rows with 24h volume", len(live), sorted((r["instrument"], r["volume"], r["close"]) for r in live))
                same = sum(1 for x, y in zip(items, items[1:]) if [(r["instrument"], r["close"], r["volume"]) for r in x] == [(r["instrument"], r["close"], r["volume"]) for r in y])
                print("   consecutive frames with identical close and volume", same, "of", len(items) - 1)
            for _, m in rows:
                if m["type"] in (3, 7):
                    print("   completion or close", json.dumps(m))
        # cancel the MiniTicker stream and see whether it stops
        await ws.send(json.dumps({"type": 5, "invocationId": "0"}) + RS)
        t_cancel = time.perf_counter()
        after = 0
        while time.perf_counter() - t_cancel < 4:
            msg = await next_msg(q, 1)
            if msg is None:
                continue
            after += sum(1 for p in msg.split(RS) if p and json.loads(p).get("invocationId") == "0")
        print("A MiniTicker frames in 4 s after cancel", after)
        await ws.send(json.dumps({"type": 7}) + RS)
        task.cancel()


async def socket_b():
    tok = negotiate()
    url = f"wss://ursa.coinlion.com/marketdata/info?id={tok}"
    async with websockets.connect(url, max_size=None, ping_interval=None) as ws:
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
        await ws.recv()
        q, task = reader(ws)
        start = time.perf_counter()
        frames = []
        try:
            while time.perf_counter() - start < HOLD_B:
                msg = await next_msg(q, 1)
                if msg is None:
                    continue
                frames.append((round(time.perf_counter() - start, 1), msg.strip(RS)))
        except websockets.ConnectionClosed as e:
            print("B closed by server after s", round(time.perf_counter() - start, 1), "code", e.code, "reason", repr(e.reason))
        else:
            print("B still open after", HOLD_B, "s")
        task.cancel()
        print("B frames", frames)


async def unknown_reuse():
    """A fresh socket: does an error on one stream leave the socket usable?"""
    tok = negotiate()
    async with websockets.connect(f"wss://ursa.coinlion.com/marketdata/info?id={tok}", max_size=None, ping_interval=None) as ws:
        await ws.send(json.dumps({"protocol": "json", "version": 1}) + RS)
        await ws.recv()
        await ws.send(json.dumps({"type": 4, "invocationId": "9", "target": "Book", "arguments": ["nope_xyz"], "streamIds": []}) + RS)
        print("C unknown reply", trim(await asyncio.wait_for(ws.recv(), 5)))
        await ws.send(json.dumps({"type": 4, "invocationId": "10", "target": "Book", "arguments": ["doge_usdc"], "streamIds": []}) + RS)
        print("C next stream on the same socket", trim(await asyncio.wait_for(ws.recv(), 5)))
        await ws.send(json.dumps({"type": 1, "invocationId": "11", "target": "Book", "arguments": ["doge_usdc"]}) + RS)
        print("C plain invocation of a stream method", trim(await asyncio.wait_for(ws.recv(), 5)))
        await ws.send(json.dumps({"type": 7}) + RS)


async def main():
    print("started UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    await unknown_reuse()
    await asyncio.gather(socket_a(), socket_b())
    print("finished UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


asyncio.run(main())
