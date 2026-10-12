# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Blynex WebSocket probe for docs/profiles/blynex/websocket.md.

Public, unauthenticated and read-only.
Blynex documents no WebSocket.
The only socket found is the futures web app's Socket.IO v4 server at wss://futures.blynex.com, named in its bundle.
It holds sockets for about 100 socket seconds in total, in this order:
  A. 60 s on the futures socket after 42["subscribe_public"]: handshake, events, cadence, price changes, pings answered.
  B. 10 s on the futures socket with no subscribe at all.
  C. 10 s on the futures socket after guessed book subscriptions, to see whether any book event exists.
  D. one handshake each on guessed spot socket URLs, since the spot trading page is behind a Cloudflare challenge.
Run from the repository root with: uv run scripts/probes/venues/blynex/ws-probe.py
Captures land in .claude/survey-work/blynex/.
"""

import asyncio
import collections
import json
import pathlib
import statistics
import time
import urllib.request

import websockets

FUT = "wss://futures.blynex.com/socket.io/?token=&EIO=4&transport=websocket"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "blynex"
WORK.mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
OUT = {}


def connect(url):
    return websockets.connect(url, compression=None, open_timeout=10, ping_interval=None, max_size=None,
                              user_agent_header=UA, additional_headers={"Origin": "https://blynex.com"})


def rest_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


async def collect(ws, secs, frames):
    end = time.time() + secs
    while True:
        left = end - time.time()
        if left <= 0:
            return None
        try:
            m = await asyncio.wait_for(ws.recv(), left)
        except asyncio.TimeoutError:
            return None
        except websockets.ConnectionClosed as e:
            return f"closed {e.rcvd.code if e.rcvd else None} {e.rcvd.reason if e.rcvd else ''}"
        frames.append((time.time(), m))
        if m == "2":
            await ws.send("3")


async def open_sio(url):
    t0 = time.perf_counter()
    ws = await connect(url).__aenter__()
    open_ms = (time.perf_counter() - t0) * 1000
    hello = await ws.recv()
    await ws.send("40")
    ack = await ws.recv()
    return ws, open_ms, hello, ack


def events(frames):
    out = []
    for t, m in frames:
        if isinstance(m, str) and m.startswith("42"):
            ev = json.loads(m[2:])
            out.append((t, ev[0], ev[1] if len(ev) > 1 else None, len(m)))
    return out


async def part_a():
    ws, open_ms, hello, ack = await open_sio(FUT)
    ext = ws.response.headers.get_all("Sec-WebSocket-Extensions")
    status = ws.response.status_code
    await ws.send('42["subscribe_public"]')
    t_sub = time.time()
    frames = []
    closed = await collect(ws, 60, frames)
    await ws.close()
    evs = events(frames)
    names = collections.Counter(e[1] for e in evs)
    first = {}
    for t, n, p, size in evs:
        first.setdefault(n, {"after_subscribe_ms": round((t - t_sub) * 1000), "bytes": size, "sample": json.dumps(p)[:700]})
    gaps = {}
    for n in names:
        ts = [t for t, nn, p, s in evs if nn == n]
        if len(ts) > 2:
            d = [(ts[i] - ts[i - 1]) * 1000 for i in range(1, len(ts))]
            gaps[n] = {"median_ms": round(statistics.median(d)), "min_ms": round(min(d)), "max_ms": round(max(d))}
    prices = [p["payload"] for t, n, p, s in evs if n == "BROADCAST_LAST_PRICE"]
    btc = [p.get("BTCUSDT") for p in prices]
    changes = {k: sum(1 for i in range(1, len(prices)) if prices[i].get(k) != prices[i - 1].get(k)) for k in (prices[0] if prices else {})}
    keys_per_frame = sorted({len(p) for p in prices})
    booky = [n for n in names if any(w in n.lower() for w in ("book", "depth", "bid", "ask"))]
    pings = sum(1 for t, m in frames if m == "2")
    spot = rest_json("https://api.blynex.com/v1/market?pair=BTC_USDT")
    spot = spot[0] if isinstance(spot, list) else spot
    okx = rest_json("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT")["data"][0]
    okx_mid = (float(okx["bidPx"]) + float(okx["askPx"])) / 2
    last_btc = btc[-1] if btc else None
    OUT["A_subscribe_public"] = {
        "upgrade_status": status, "open_ms": round(open_ms), "extensions": ext, "engineio_open": hello, "socketio_connect_ack": ack,
        "event_counts": dict(names), "first_of_each": first, "gaps": gaps, "price_keys_per_frame": keys_per_frame,
        "price_changes_per_pair_over_frames": changes, "btc_distinct_values": len(set(btc)), "book_like_events": booky,
        "server_pings_answered": pings, "closed": closed,
        "btc_last_vs_okx_mid_ppm": round((last_btc - okx_mid) / okx_mid * 1e6) if last_btc else None,
        "btc_last_vs_spot_last_ppm": round((last_btc - spot["lastPrice"]) / spot["lastPrice"] * 1e6) if last_btc else None,
    }
    (WORK / "ws-futures-frames.json").write_text(json.dumps([[t, m] for t, m in frames][:200]))
    print("A", json.dumps(OUT["A_subscribe_public"], indent=1))


async def part_b():
    ws, open_ms, hello, ack = await open_sio(FUT)
    frames = []
    closed = await collect(ws, 10, frames)
    await ws.close()
    OUT["B_no_subscribe"] = {"event_counts": dict(collections.Counter(e[1] for e in events(frames))), "frames": len(frames), "closed": closed}
    print("B", json.dumps(OUT["B_no_subscribe"]))


async def part_c():
    ws, open_ms, hello, ack = await open_sio(FUT)
    sent = ['42["subscribe_public"]', '42["subscribe","BTCUSDT"]', '42["orderbook","BTCUSDT"]', '42["depth",{"pair":"BTCUSDT"}]',
            '42["subscribe_orderbook","BTCUSDT"]']
    for s in sent:
        await ws.send(s)
    frames = []
    closed = await collect(ws, 10, frames)
    await ws.close()
    other = [m[:200] for t, m in frames if not (isinstance(m, str) and (m.startswith('42["BROADCAST_LAST_PRICE"') or m.startswith('42["24_MARKET"') or m == "2"))]
    OUT["C_guessed_book_events"] = {"sent": sent, "event_counts": dict(collections.Counter(e[1] for e in events(frames))),
                                    "other_frames": other, "closed": closed}
    print("C", json.dumps(OUT["C_guessed_book_events"], indent=1))


async def part_d():
    res = {}
    for url in ["wss://api.blynex.com/", "wss://api.blynex.com/ws", "wss://blynex.com/ws", "wss://blynex.com/socket.io/?EIO=4&transport=websocket",
                "wss://blynex.com/socket.io/?EIO=3&transport=websocket", "wss://futures.blynex.com/ws"]:
        try:
            async with connect(url) as ws:
                try:
                    first = await asyncio.wait_for(ws.recv(), 4)
                except asyncio.TimeoutError:
                    first = None
                res[url] = {"upgrade": ws.response.status_code, "first_frame": (first or "")[:200]}
        except websockets.InvalidStatus as e:
            body = e.response.body or b""
            res[url] = {"refused_status": e.response.status_code, "server": e.response.headers.get("Server"),
                        "cf-mitigated": e.response.headers.get("cf-mitigated"), "body": body[:120].decode(errors="replace")}
        except Exception as e:
            res[url] = {"error": f"{type(e).__name__}: {e}"[:200]}
    OUT["D_spot_candidates"] = res
    print("D", json.dumps(res, indent=1))


async def main():
    await part_a()
    await part_b()
    await part_c()
    await part_d()
    (WORK / "ws-probe.json").write_text(json.dumps(OUT, indent=1))
    print("wrote", WORK / "ws-probe.json")


if __name__ == "__main__":
    asyncio.run(main())
