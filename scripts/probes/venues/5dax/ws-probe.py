# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only WebSocket probe for 5DAX, public spot market data only.

5DAX documents no socket.
The web app reads the socket host from GET https://5dax.com/settings/getSettingByKey/wssUrl,
which answered https://socket.5dax.com, and its bundled client is Socket.IO v2.4.0 (Engine.IO protocol 3).
The app joins the namespace /<lowercase symbol> for book deltas, /<symbol>_aggTrade for trades
and /miniTicker for tickers,
and reads every payload from the event "message".
This probe speaks that framing by hand over a plain WebSocket:
    0{...}            Engine.IO open, with sid, pingInterval and pingTimeout
    2 and 3           Engine.IO ping from the client and pong from the server
    40/<nsp>,         join a namespace, and the server's acknowledgement
    42/<nsp>,[ev,d]   an event on a namespace

Modes, all by default, or name some on the command line:
    connect  the upgrade, its status and headers, and the Engine.IO open packet, plus the polling transport
    listen   one socket that joins /btcusdt, /ethusdt, /usdcusdt, /ethbtc, /miniTicker and /btcusdt_aggTrade and records every
             packet for 90 s while sending Engine.IO pings, and a second socket that joins /btcusdt and
             sends no ping, to see when the server drops a silent client
             it also reads the REST depth of BTCUSDT on both hosts at the start, to compare update ids
    errors   an unknown symbol namespace, an upper case namespace, a client event, a malformed packet

Each packet is printed as one JSON line.
The socket time of a full run is about 3.5 minutes, two sockets of up to 90 s at once and a short errors socket.

Run from the repository root:
    uv run scripts/probes/venues/5dax/ws-probe.py [mode ...]
"""

import asyncio
import json
import sys
import time
import urllib.request
from collections import Counter, defaultdict

import websockets

URL = "wss://socket.5dax.com/socket.io/?EIO=3&transport=websocket"
POLL_URL = "https://socket.5dax.com/socket.io/?EIO=3&transport=polling"
ORIGIN = "https://5dax.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
LISTEN_S = 90
BOOKS = ["btcusdt", "ethusdt", "usdcusdt", "ethbtc"]
OTHER = ["miniTicker", "btcusdt_aggTrade"]  # the app also opens /<symbol>_kline_<interval>


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def now() -> str:
    return time.strftime("%H:%M:%S", time.gmtime()) + f".{int(time.time() * 1000) % 1000:03d}Z"


def http_get(url: str) -> tuple[int, str]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode(errors="replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")


async def open_ws():
    return await websockets.connect(URL, origin=ORIGIN, user_agent_header=UA, ping_interval=None,
                                    open_timeout=15, max_size=2**22)


async def open_sio(tag: str):
    """Open until the Engine.IO open packet arrives, since many upgrades close at once with no packet."""
    for attempt in range(1, 9):
        ws = await open_ws()
        try:
            first = str(await asyncio.wait_for(ws.recv(), timeout=10))
            out(tag=tag, attempt=attempt, at=now(), open=first[:200])
            return ws, json.loads(first[1:])
        except (websockets.exceptions.ConnectionClosed, asyncio.TimeoutError) as e:
            out(tag=tag, attempt=attempt, at=now(), failed=repr(e)[:150])
            await asyncio.sleep(1)
    raise RuntimeError("no Engine.IO open packet in 8 attempts")


def parse(pkt: str) -> dict:
    """Split one Engine.IO text packet into its Socket.IO parts."""
    if not pkt:
        return {"eio": None}
    eio = pkt[0]
    rest = pkt[1:]
    if eio != "4":
        return {"eio": eio, "body": rest}
    sio = rest[:1]
    rest = rest[1:]
    nsp = "/"
    if rest.startswith("/"):
        comma = rest.find(",")
        if comma == -1:
            nsp, rest = rest, ""
        else:
            nsp, rest = rest[:comma], rest[comma + 1:]
    data = None
    if rest:
        try:
            data = json.loads(rest)
        except ValueError:
            data = rest
    return {"eio": "4", "sio": sio, "nsp": nsp, "data": data}


async def connect_mode() -> None:
    status, body = http_get(POLL_URL)
    out(mode="connect", transport="polling", status=status, body=body[:200])
    for i in range(6):
        await connect_once(i + 1)
        await asyncio.sleep(1)


async def connect_once(attempt: int) -> None:
    t0 = time.perf_counter()
    try:
        ws = await open_ws()
    except websockets.exceptions.InvalidStatus as e:
        r = e.response
        out(mode="connect", upgraded=False, status=r.status_code, body=(r.body or b"")[:300].decode(errors="replace"))
        return
    ms = round((time.perf_counter() - t0) * 1000)
    resp = ws.response
    out(mode="connect", attempt=attempt, upgraded=True, status=resp.status_code, handshake_ms=ms,
        headers={k: v for k, v in resp.headers.raw_items() if k.lower() in (
            "server", "sec-websocket-extensions", "cf-ray", "upgrade", "connection")})
    for _ in range(2):
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=5)
            out(mode="connect", attempt=attempt, at=now(), packet=str(msg)[:300])
        except asyncio.TimeoutError:
            out(mode="connect", note="nothing more within 5 s")
            break
        except websockets.exceptions.ConnectionClosed as e:
            out(mode="connect", attempt=attempt, at=now(), closed_by_server=str(e)[:200])
            return
    await ws.close()


def book_check(st: dict, sym: str, d: dict) -> None:
    """Track the Binance style U and u fields and the level order of one depthUpdate."""
    s = st[sym]
    s["n"] += 1
    U, u = d.get("U"), d.get("u")
    s["first_U_u"] = s.get("first_U_u") or [U, u]
    s["types"].add(f"U:{type(U).__name__} u:{type(u).__name__}")
    if isinstance(U, int) and isinstance(u, int):
        s["span"][u - U] += 1
        prev = s.get("prev_u")
        if prev is not None:
            if U == prev + 1:
                s["contiguous"] += 1
            elif U <= prev:
                s["overlap"] += 1
            else:
                s["gap"] += 1
                s["gap_sizes"].append(U - prev - 1)
        s["prev_u"] = u
    bids = d.get("b") or []
    asks = d.get("a") or []
    s["levels"][f"b{len(bids)}a{len(asks)}"] += 1
    for side, lv, desc in (("b", bids, True), ("a", asks, False)):
        prices = [float(x[0]) for x in lv]
        if prices != sorted(prices, reverse=desc):
            s["unsorted"][side] += 1
        s["zero"] += sum(1 for x in lv if float(x[1]) == 0)
        if lv:
            s["level_shape"].add(json.dumps([type(v).__name__ for v in lv[0]]))
    if d.get("z"):
        s["z_true"] += 1


async def listen_pinging(results: dict) -> None:
    ws, opened = await open_sio("listen pinging")
    ping_s = opened.get("pingInterval", 25000) / 1000
    for nsp in BOOKS + OTHER:
        await ws.send(f"40/{nsp},")
    out(mode="listen", sock="pinging", at=now(), sent=[f"40/{n}," for n in BOOKS + OTHER], listen_s=LISTEN_S)
    st: dict = defaultdict(lambda: {"n": 0, "contiguous": 0, "overlap": 0, "gap": 0, "gap_sizes": [],
                                    "span": Counter(), "levels": Counter(), "unsorted": Counter(), "zero": 0,
                                    "types": set(), "level_shape": set(), "z_true": 0})
    kinds: Counter = Counter()
    keys: dict = {}
    arrivals: dict = defaultdict(list)
    printed: Counter = Counter()
    t_end = time.monotonic() + LISTEN_S
    next_ping = time.monotonic() + ping_s
    ping_sent = None
    pongs = []
    closed = None
    while time.monotonic() < t_end:
        timeout = max(0.05, min(t_end, next_ping) - time.monotonic())
        try:
            msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
        except asyncio.TimeoutError:
            if time.monotonic() >= next_ping:
                await ws.send("2")
                ping_sent = time.monotonic()
                next_ping = ping_sent + ping_s
            continue
        except websockets.exceptions.ConnectionClosed as e:
            closed = {"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None, "at": now()}
            break
        p = parse(str(msg))
        if p["eio"] == "3":
            pongs.append(round((time.monotonic() - ping_sent) * 1000) if ping_sent else None)
            out(mode="listen", sock="pinging", at=now(), packet=str(msg))
            continue
        nsp = p.get("nsp", "?")
        data = p.get("data")
        ev = data[0] if isinstance(data, list) and data else None
        body = data[1] if isinstance(data, list) and len(data) > 1 else None
        kind = f"{p['eio']}{p.get('sio', '')}:{nsp}:{ev}"
        if isinstance(body, dict):
            kind += f":{body.get('e')}"
            keys.setdefault(kind, sorted(body.keys()))
            if body.get("e") == "depthUpdate":
                book_check(st, nsp.strip("/"), body)
                arrivals[nsp].append(time.monotonic())
        elif isinstance(body, list):
            kind += f":list[{len(body)}]"
            if body and isinstance(body[0], dict):
                keys.setdefault(kind, sorted(body[0].keys()))
        kinds[kind] += 1
        if printed[kind] < 3:
            printed[kind] += 1
            out(mode="listen", sock="pinging", at=now(), bytes=len(msg), packet=str(msg)[:700])
    if closed is None:
        await ws.close()
    gaps = {}
    for nsp, ts in arrivals.items():
        d = sorted(round(b - a, 2) for a, b in zip(ts, ts[1:]))
        if d:
            gaps[nsp] = {"min": d[0], "median": d[len(d) // 2], "max": d[-1]}
    books = {}
    for sym, s in st.items():
        books[sym] = {k: (dict(v) if isinstance(v, Counter) else sorted(v) if isinstance(v, set) else v)
                      for k, v in s.items() if k not in ("prev_u",)}
        books[sym]["gap_sizes"] = s["gap_sizes"][:20]
        books[sym]["last_u"] = s.get("prev_u")
    results["pinging"] = True
    out(mode="listen", sock="pinging", summary=True, packets=sum(kinds.values()), by_kind=dict(kinds),
        keys_by_kind=keys, books=books, interarrival_s=gaps, pong_ms=pongs, server_closed=closed)


async def listen_silent() -> None:
    ws, opened = await open_sio("listen silent")
    t0 = time.monotonic()
    await ws.send("40/btcusdt,")
    n = 0
    closed = None
    while time.monotonic() - t0 < LISTEN_S:
        try:
            await asyncio.wait_for(ws.recv(), timeout=LISTEN_S - (time.monotonic() - t0))
            n += 1
        except asyncio.TimeoutError:
            break
        except websockets.exceptions.ConnectionClosed as e:
            closed = {"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None,
                      "after_s": round(time.monotonic() - t0, 1), "at": now()}
            break
    if closed is None:
        await ws.close()
    out(mode="listen", sock="silent", summary=True, packets=n, server_closed=closed,
        open_at_end=closed is None)


def rest_ids(when: str) -> None:
    """The REST snapshot ids, to line up with the socket's U and u."""
    for name, url in (("api", "https://api.5dax.com/api/v1/depth?symbol={}&limit=5"),
                      ("site", "https://5dax.com/exchange/depth?symbol={}&limit=5")):
        for sym in ("BTCUSDT", "ETHUSDT"):
            status, body = http_get(url.format(sym))
            try:
                luid = json.loads(body).get("lastUpdateId")
            except ValueError:
                luid = body[:100]
            out(mode="listen", at=now(), when=when, rest_depth=name, symbol=sym, status=status, lastUpdateId=luid)


async def listen_mode() -> None:
    rest_ids("before")
    await asyncio.gather(listen_pinging({}), listen_silent())
    rest_ids("after")


async def errors_mode() -> None:
    ws, _ = await open_sio("errors")
    tests = [
        ("unknown symbol namespace", "40/nopeusdt,"),
        ("upper case namespace", "40/BTCUSDT,"),
        ("client event on a joined namespace", '42/nopeusdt,["subscribe",{"symbol":"BTCUSDT"}]'),
        ("client event on the root namespace", '42["subscribe","btcusdt@depth"]'),
        ("malformed packet", "hello"),
        ("leave a namespace", "41/nopeusdt,"),
    ]
    for name, frame in tests:
        try:
            await ws.send(frame)
        except websockets.exceptions.ConnectionClosed as e:
            out(mode="errors", test=name, sent=frame, closed_before_send=str(e)[:200])
            return
        replies = []
        t_end = time.monotonic() + 6
        closed = None
        while time.monotonic() < t_end:
            try:
                replies.append(str(await asyncio.wait_for(ws.recv(), timeout=t_end - time.monotonic()))[:300])
            except asyncio.TimeoutError:
                break
            except websockets.exceptions.ConnectionClosed as e:
                closed = {"code": e.rcvd.code if e.rcvd else None, "reason": e.rcvd.reason if e.rcvd else None}
                break
        out(mode="errors", test=name, sent=frame, replies=replies[:5], reply_count=len(replies), closed=closed)
        if closed:
            ws, _ = await open_sio("errors reopen")
    await ws.close()


async def main() -> None:
    modes = sys.argv[1:] or ["connect", "listen", "errors"]
    out(probe="5dax ws", started=now(), modes=modes)
    for m in modes:
        await {"connect": connect_mode, "listen": listen_mode, "errors": errors_mode}[m]()
    out(probe="5dax ws", finished=now())


if __name__ == "__main__":
    asyncio.run(main())
