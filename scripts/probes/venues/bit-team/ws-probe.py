# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for BIT.TEAM, spot only.

The web app talks to wss://bit.team/trade/ws/ with the hapi nes protocol, version 2, found in its Nuxt bundle.
A client sends {"type":"hello","version":"2","auth":{"headers":{"Authorization":"jwt"}}}, which is what the app sends
without a login, then {"type":"sub","path":"/orderbooks/<pairId>"} per book.
The server sends {"type":"ping"} and the client answers {"type":"ping","id":n}.

Modes, all by default, or name some on the command line:
    book     one socket for 120 s on /orderbooks/ of del_rub (51), del_usdt (24), usdt_rub (53) and btc_usdt (22),
             plus /trades/53, /prices and /pairs.
             It reports the hello reply, the sub acks, the time to the first book of each pair, whether each push is a whole book,
             depth per side, push intervals, exact repeats, any sequence or timestamp field, level order, crossing,
             zero sizes, the server ping spacing, and the first frame of every other channel.
             It then compares the last pushed top of book with REST /trade/api/orderbooks/{name}.
    errors   one short socket: an unknown pair id, a pair name, an inactive pair id, an unknown path, a private path,
             a frame without type, an unknown type, text that is not JSON, a sub before hello and an unsub.
    idle     one socket that subscribes nothing and never answers a server ping, for up to 60 s, to see when the server closes it.
    hosts    the other socket URLs in the bundle: wss://bit.team/trade/api/ and wss://history.bit.team/api/, one hello each.

Total socket time is about 3.5 minutes.
The flag --short halves the book and idle windows for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/bit-team/ws-probe.py [--short] [mode ...]
"""

import asyncio
import hashlib
import json
import statistics
import sys
import time
import urllib.request

import websockets

URL = "wss://bit.team/trade/ws/"
ORIGIN = "https://bit.team"
HELLO = {"type": "hello", "version": "2", "auth": {"headers": {"Authorization": "jwt"}}}
BOOKS = {51: "del_rub", 24: "del_usdt", 53: "usdt_rub", 22: "btc_usdt"}
SHORT = "--short" in sys.argv


def now():
    return time.monotonic()


class Nes:
    def __init__(self, ws):
        self.ws = ws
        self.n = 0

    async def send(self, frame):
        self.n += 1
        frame = dict(frame)
        frame.setdefault("id", self.n)
        await self.ws.send(json.dumps(frame))


def ext_of(ws):
    try:
        return ws.response.headers.get("Sec-WebSocket-Extensions")
    except Exception:
        return None


async def book():
    secs = 60 if SHORT else 120
    print(f"== book, {secs} s")
    pushes = {pid: [] for pid in BOOKS}
    other_first = {}
    pings = []
    t0 = now()
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=20, max_size=None) as ws:
        print(f"open {URL}: status {ws.response.status_code}, extensions {ext_of(ws)}, server {ws.response.headers.get('Server')}")
        nes = Nes(ws)
        await nes.send(HELLO)
        while True:  # the server may ping before it answers the hello
            raw = await ws.recv()
            print(f"before subscribing, {now() - t0:.2f} s: {raw}")
            if json.loads(raw).get("type") == "ping":
                pings.append(now())
                await nes.send({"type": "ping"})
            else:
                break
        t_sub = {}
        for pid in BOOKS:
            t_sub[pid] = now()
            await nes.send({"type": "sub", "path": f"/orderbooks/{pid}"})
        for path in ["/trades/53", "/prices", "/pairs"]:
            await nes.send({"type": "sub", "path": path})
        end = t0 + secs
        while now() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - now())
            except asyncio.TimeoutError:
                break
            t = now()
            m = json.loads(raw)
            if m.get("type") == "ping":
                pings.append(t)
                await nes.send({"type": "ping"})
                continue
            if m.get("type") == "sub":
                print(f"ack {raw} at {t - t0:.2f} s")
                continue
            if m.get("type") != "pub":
                print(f"other frame {raw[:300]}")
                continue
            path = m["path"]
            if path.startswith("/orderbooks/"):
                pid = int(path.rsplit("/", 1)[1])
                pushes[pid].append((t, m["message"], len(raw)))
            else:
                key = (path, m["message"].get("type"))
                if key not in other_first:
                    other_first[key] = (t - t0, raw[:400])
    print(f"socket held {now() - t0:.1f} s")
    gaps = [b - a for a, b in zip(pings, pings[1:])]
    print(f"server pings {len(pings)}, spacing s {[round(g, 2) for g in gaps]}")
    for key, (at, raw) in sorted(other_first.items()):
        print(f"first {key[0]} type {key[1]} at {at:.1f} s: {raw}")
    last_top = {}
    for pid, name in BOOKS.items():
        ps = pushes[pid]
        if not ps:
            print(f"{name} ({pid}): no push in {secs} s")
            continue
        msg_types = sorted({p[1].get("type") for p in ps})
        msg_keys = sorted({k for p in ps for k in p[1].keys()})
        data_keys = sorted({k for p in ps for k in p[1]["data"].keys()})
        level_keys = sorted({k for p in ps for side in ("bids", "asks") for lv in p[1]["data"]["orderbooks"][side][:1] for k in lv})
        depths = sorted({(len(p[1]["data"]["orderbooks"]["bids"]), len(p[1]["data"]["orderbooks"]["asks"])) for p in ps})
        intervals = [b[0] - a[0] for a, b in zip(ps, ps[1:])]
        digests = [hashlib.sha1(json.dumps(p[1]["data"]["orderbooks"], sort_keys=True).encode()).hexdigest() for p in ps]
        repeats = sum(1 for a, b in zip(digests, digests[1:]) if a == b)
        bad_order = crossed = zeros = dupes = 0
        for _, msg, _ in ps:
            ob = msg["data"]["orderbooks"]
            bp = [float(x["price"]) for x in ob["bids"]]
            ap = [float(x["price"]) for x in ob["asks"]]
            if bp != sorted(bp, reverse=True) or ap != sorted(ap):
                bad_order += 1
            if bp and ap and bp[0] >= ap[0]:
                crossed += 1
            zeros += sum(1 for side in ("bids", "asks") for x in ob[side] if float(x["quantity"]) == 0)
            dupes += (len(bp) - len(set(bp))) + (len(ap) - len(set(ap)))
        sizes = [p[2] for p in ps]
        print(f"{name} ({pid}): {len(ps)} pushes, first {ps[0][0] - t_sub[pid]:.2f} s after its sub, message types {msg_types}, "
              f"message keys {msg_keys}, data keys {data_keys}, level keys {level_keys}")
        print(f"  depth (bids, asks) seen {depths}, unordered {bad_order}, crossed {crossed}, zero sizes {zeros}, duplicate prices {dupes}, "
              f"exact repeats of the previous push {repeats}, frame bytes {min(sizes)} to {max(sizes)}")
        if intervals:
            print(f"  intervals s min {min(intervals):.2f} median {statistics.median(intervals):.2f} max {max(intervals):.2f}")
        first = json.loads(json.dumps(ps[0][1]))
        for side in ("bids", "asks"):
            first["data"]["orderbooks"][side] = first["data"]["orderbooks"][side][:2]
        print(f"  first push cut to two levels a side: {json.dumps({'type': 'pub', 'path': f'/orderbooks/{pid}', 'message': first}, separators=(',', ':'))}")
        q = ps[-1][1]["data"].get("quantities")
        ob = ps[-1][1]["data"]["orderbooks"]
        sums = {side: (round(sum(float(x["quantity"]) for x in ob[side]), 8), round(sum(float(x["amount"]) for x in ob[side]), 8)) for side in ("bids", "asks")}
        print(f"  last push sums over the levels pushed, (quantity, amount): {sums}")
        print(f"  last quantities {q}, last top {ob['bids'][:1]} {ob['asks'][:1]}, price type {type(ob['bids'][0]['price']).__name__ if ob['bids'] else None}")
        last_top[name] = (ob["bids"][:1], ob["asks"][:1], ps[-1][0], q)
    for name, (b, a, t, q) in last_top.items():
        with urllib.request.urlopen(urllib.request.Request(f"{ORIGIN}/trade/api/orderbooks/{name}", headers={"User-Agent": "survey-probe"}), timeout=20) as r:
            rb = json.loads(r.read())["result"]
        print(f"REST {name} {now() - t:.1f} s after the last push: top {rb['bids'][:1]} {rb['asks'][:1]}, depth {len(rb['bids'])} {len(rb['asks'])}, "
              f"same top as the last push {bool(b and rb['bids'] and b[0]['price'] == rb['bids'][0][0] and a and rb['asks'] and a[0]['price'] == rb['asks'][0][0])}")
        sums = {side: (round(sum(float(x[1]) for x in rb[side]), 8), round(sum(float(x[0]) * float(x[1]) for x in rb[side]), 8)) for side in ("bids", "asks")}
        print(f"  REST sums over all levels, (base, quote): {sums}, against the last push quantities {q}")


async def drain(ws, secs):
    out = []
    end = now() + secs
    while now() < end:
        try:
            out.append(await asyncio.wait_for(ws.recv(), timeout=end - now()))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            out.append(f"<closed {e.rcvd.code if e.rcvd else None} {e.rcvd.reason if e.rcvd else ''}>")
            break
    return out


async def errors():
    print("== errors")
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=20) as ws:
        nes = Nes(ws)
        await nes.send({"type": "sub", "path": "/orderbooks/51"})
        print(f"sub before hello: {await drain(ws, 3)}")
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=20) as ws:
        nes = Nes(ws)
        await nes.send(HELLO)
        await drain(ws, 2)
        cases = [
            ("unknown pair id", {"type": "sub", "path": "/orderbooks/99999"}),
            ("pair name", {"type": "sub", "path": "/orderbooks/btc_usdt"}),
            ("inactive pair id 13", {"type": "sub", "path": "/orderbooks/13"}),
            ("unknown path", {"type": "sub", "path": "/depth/51"}),
            ("private path", {"type": "sub", "path": "/balances"}),
            ("path without slash", {"type": "sub", "path": "orderbooks/51"}),
            ("repeat sub", {"type": "sub", "path": "/orderbooks/51"}),
            ("repeat sub again", {"type": "sub", "path": "/orderbooks/51"}),
            ("unsub", {"type": "unsub", "path": "/orderbooks/51"}),
            ("unknown type", {"type": "hello2"}),
            ("request over socket", {"type": "request", "method": "GET", "path": "/trade/api/pair/btc_usdt"}),
            ("no type", {"path": "/orderbooks/51"}),
        ]
        for label, frame in cases:
            await nes.send(frame)
            got = [g for g in await drain(ws, 2.5) if '"type":"ping"' not in g and '"pub"' not in g]
            print(f"{label} {json.dumps(frame)}: {[g[:250] for g in got]}")
            if got and got[-1].startswith("<closed"):
                return
        await ws.send("not json")
        print(f"not json: {[g[:250] for g in await drain(ws, 2.5)]}")


async def idle():
    secs = 30 if SHORT else 60
    print(f"== idle, up to {secs} s, no pong")
    t0 = now()
    async with websockets.connect(URL, origin=ORIGIN, open_timeout=20, ping_interval=None) as ws:
        await ws.send(json.dumps(dict(HELLO, id=1)))
        end = t0 + secs
        while now() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=end - now())
                print(f"{now() - t0:.2f} s: {raw[:200]}")
            except asyncio.TimeoutError:
                print(f"still open at {now() - t0:.1f} s")
                break
            except websockets.ConnectionClosed as e:
                print(f"closed at {now() - t0:.2f} s, code {e.rcvd.code if e.rcvd else None}, reason {e.rcvd.reason if e.rcvd else ''!r}")
                break


async def hosts():
    print("== hosts")
    for url in ["wss://bit.team/trade/api/", "wss://history.bit.team/api/"]:
        try:
            async with websockets.connect(url, origin=ORIGIN, open_timeout=20) as ws:
                await ws.send(json.dumps(dict(HELLO, id=1)))
                print(f"{url}: status {ws.response.status_code}, reply {[g[:200] for g in await drain(ws, 3)]}")
        except Exception as e:
            print(f"{url}: {type(e).__name__} {e}")


MODES = {"book": book, "errors": errors, "idle": idle, "hosts": hosts}

if __name__ == "__main__":
    chosen = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    print(f"run at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}, short {SHORT}")
    for m in chosen:
        asyncio.run(MODES[m]())
