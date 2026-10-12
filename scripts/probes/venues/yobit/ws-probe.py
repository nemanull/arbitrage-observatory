# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""YoBit public WebSocket probe, read-only and unauthenticated.

YoBit documents no WebSocket API.
Its web app loads autobahn.js and /js/corews.js, whose obfuscated strings decode to the URL wss://propusher24.com, the WAMP realm restricted_realm and the topics ordlst<pair_id>, trhist<pair_id>, ticker, tickerst and hb.
The numeric pair_id is the pair_id variable of each trade page, such as https://yobit.net/en/trade/BTC/USDT.
This probe speaks WAMP v2 over JSON the way autobahn does, as a subscriber only.

Run from the repository root: uv run scripts/probes/venues/yobit/ws-probe.py [mode]
Modes and their socket time:
  session  about 90 s: three pairs' book and trade topics, ticker, tickerst, hb and an unknown topic, then a replay of the book deltas onto a REST snapshot
  silence  up to 150 s: subscribe ticker, send nothing, client pings off, wait for the server to close
  all      session, then silence (the default)
"""

import asyncio
import collections
import json
import logging
import re
import sys
import time
import urllib.request

import websockets

WS = "wss://propusher24.com"
ORIGIN = "https://yobit.net"
REALM = "restricted_realm"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
PAIRS = {"BTC/USDT": "btc_usdt", "ETH/BTC": "eth_btc", "ETH/USDT": "eth_usdt"}


class PingCounter(logging.Handler):
    """websockets logs every control frame at debug level, which is the only way to see the server's pings."""

    def __init__(self):
        super().__init__(logging.DEBUG)
        self.counts = collections.Counter()

    def emit(self, record):
        msg = record.getMessage()
        for kind in ("< PING", "< PONG", "> PING", "> PONG", "< CLOSE", "> CLOSE"):
            if msg.startswith(kind):
                self.counts[kind] += 1


PINGS = PingCounter()
logging.getLogger("websockets").setLevel(logging.DEBUG)
logging.getLogger("websockets").addHandler(PINGS)
logging.getLogger("websockets").propagate = False


def http_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def pair_id(pair):
    body = http_get(f"https://yobit.net/en/trade/{pair}")
    return re.search(rb"pair_id = '(\d+)'", body).group(1).decode()


def rest_book(name):
    doc = json.loads(http_get(f"https://yobit.net/api/3/depth/{name}?limit=2000"))[name]
    return {1: {f"{p:.8f}": a for p, a in doc.get("bids") or []}, 2: {f"{p:.8f}": a for p, a in doc.get("asks") or []}}


def trim(s, n=300):
    return s if len(s) <= n else s[:n] + "..."


async def hello(ws):
    await ws.send(json.dumps([1, REALM, {"roles": {"subscriber": {"features": {}}}}]))
    welcome = json.loads(await ws.recv())
    details = welcome[2]
    transport = details.get("transport", {})
    print("welcome code", welcome[0], "session", welcome[1], "roles", json.dumps(details.get("roles")), "transport type", transport.get("type"))
    print("welcome echoes request headers named", sorted(transport.get("headers", {})))
    return welcome


def top(book, side, n=20):
    return dict(sorted(book[side].items(), key=lambda kv: float(kv[0]), reverse=side == 1)[:n])


def replay(snapshot, events):
    book = {1: dict(snapshot[1]), 2: dict(snapshot[2])}
    for ev in events:
        side, price, amount = ev[2], ev[3], float(ev[4])
        if amount == 0:
            book[side].pop(price, None)
        else:
            book[side][price] = amount
    return book


async def session():
    print("\n## session")
    ids = {}
    for pair in PAIRS:
        ids[pair] = pair_id(pair)
        time.sleep(1.1)
    print("pair ids", ids)
    topics = {}
    for pair, pid in ids.items():
        topics[f"ordlst{pid}"] = pair
        topics[f"trhist{pid}"] = pair
    topics.update({"ticker": None, "tickerst": None, "hb": None, "ordlst99999999": "unknown"})
    t0 = time.time()
    async with websockets.connect(WS, subprotocols=["wamp.2.json"], origin=ORIGIN, user_agent_header=UA, open_timeout=20) as ws:
        print(f"connected in {time.time() - t0:.2f} s, subprotocol {ws.subprotocol}, Server {ws.response.headers.get('Server')}")
        print("Sec-WebSocket-Extensions in the answer", ws.response.headers.get("Sec-WebSocket-Extensions"))
        await hello(ws)
        req_topic = {}
        sub_topic = {}
        per_topic = collections.Counter()
        first = {}
        ops = collections.Counter()
        flags = collections.Counter()
        deltas = collections.defaultdict(list)  # pair_id to [(arrival time, event)]
        other = []

        async def receive():
            async for raw in ws:
                msg = json.loads(raw)
                if msg[0] == 33:
                    sub_topic[msg[2]] = req_topic[msg[1]]
                    print(f"SUBSCRIBED {req_topic[msg[1]]}: {raw}")
                    continue
                if msg[0] != 36:
                    other.append((round(time.time() - t0, 2), raw))
                    continue
                topic = sub_topic.get(msg[1], "?")
                per_topic[topic] += 1
                first.setdefault(topic, (round(time.time() - t0, 2), raw))
                if topic.startswith("ordlst"):
                    for item in msg[4]:
                        ev = json.loads(item)
                        ops[(ev[1], ev[2])] += 1
                        flags[(ev[1], ev[6], float(ev[4]) == 0)] += 1
                        deltas[ev[0]].append((time.time(), ev))

        task = asyncio.create_task(receive())
        for i, topic in enumerate(topics, start=1):
            req_topic[i] = topic
            await ws.send(json.dumps([32, i, {}, topic]))
        await asyncio.sleep(2)
        snapshots = {}
        for name in PAIRS.values():
            start = time.time()
            snapshots[name] = (start, await asyncio.to_thread(rest_book, name))
            await asyncio.sleep(1.1)
        await asyncio.sleep(60)
        fresh = {}
        for name in PAIRS.values():
            start = time.time()
            fresh[name] = (start, await asyncio.to_thread(rest_book, name), time.time())
            await asyncio.sleep(1.1)
        await asyncio.sleep(3)
        print(f"events per topic in {time.time() - t0:.0f} s: {dict(per_topic)}")
        print("non-event frames", other[:5])
        print("book ops by (op, side)", dict(ops))
        print("book events by (op, last field, amount is zero)", dict(flags))
        for topic, (t, raw) in first.items():
            print(f"first {topic} at {t} s: {trim(raw, 400)}")
        await ws.send(json.dumps([34, 999, next(k for k, v in sub_topic.items() if v == "ticker")]))
        await asyncio.sleep(3)
        print("frames after UNSUBSCRIBE", other[-3:])
        await ws.send(json.dumps([6, {}, "wamp.close.normal"]))
        await asyncio.sleep(3)
        print("frames after GOODBYE", other[-3:])
        task.cancel()
    print("control frames", dict(PINGS.counts))
    print("\n## replay of deltas onto the first REST snapshot, compared with a second REST snapshot")
    for pair, pid in ids.items():
        name = PAIRS[pair]
        s0, snap = snapshots[name]
        s1, after, s1_end = fresh[name]
        evs = deltas.get(int(pid), [])
        used = [ev for t, ev in evs if s0 <= t < s1]
        near = [round(t - s1, 2) for t, ev in evs if s1 - 3 <= t <= s1_end + 3]
        book = replay(snap, used)
        for side, label in ((1, "bids"), (2, "asks")):
            mine, theirs = top(book, side), top(after, side)
            keys = set(mine) | set(theirs)
            diff = sorted((k, mine.get(k), theirs.get(k)) for k in keys if mine.get(k) != theirs.get(k))
            print(f"{pair} {label}: {len(used)} deltas replayed, {len(diff)} of {len(keys)} top-20 prices differ, events within 3 s of the second snapshot at {near}")
            for row in diff[:4]:
                print("  price, replayed amount, fresh amount", row)


async def silence():
    print("\n## silence")
    PINGS.counts.clear()
    t0 = time.time()
    frames = 0
    reason = "no close within 150 s"
    try:
        async with websockets.connect(WS, subprotocols=["wamp.2.json"], origin=ORIGIN, user_agent_header=UA, open_timeout=20, ping_interval=None) as ws:
            await hello(ws)
            await ws.send(json.dumps([32, 1, {}, "ticker"]))
            while time.time() - t0 < 150:
                try:
                    await asyncio.wait_for(ws.recv(), timeout=150 - (time.time() - t0))
                    frames += 1
                except asyncio.TimeoutError:
                    break
    except websockets.ConnectionClosed as e:
        reason = f"closed by server after {time.time() - t0:.1f} s, code {e.rcvd.code if e.rcvd else None}, reason {e.rcvd.reason if e.rcvd else None}"
    print(f"silence: {reason}, frames {frames}, control frames {dict(PINGS.counts)}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("YoBit WebSocket probe at", time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime()), "mode", mode)
    if mode in ("session", "all"):
        asyncio.run(session())
    if mode in ("silence", "all"):
        asyncio.run(silence())


if __name__ == "__main__":
    main()
