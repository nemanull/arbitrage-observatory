# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""WOO X Pro public futures WebSocket probe.

Public, unauthenticated and read-only.
Sockets open without permessage-deflate, like the engine's feeds, except in the deflate mode.
Run from the repository root: uv run scripts/probes/venues/woo-x-pro/ws-probe.py <mode>

  book      depthIncrease50@100ms on every live contract (Trading with 24 h volume) on one socket for 60 s, with snapshots, version chain, cadence, level order and window, and empty books, about 65 s
  channels  depth50, depthAll50, depthIncrease20@200ms, bookticker, ticker with a symbol, fundingRate, trade, the request action, and unknown, delisted and malformed topics, about 25 s
  ticker    futures/ticker without a symbol for 40 s: contracts covered, interval per contract, mark against index, about 42 s
  framecap  one socket per subscribe frame size from 1,000 to 4,500 bytes, about 25 s
  silence   five sockets that differ in what the client subscribes and sends, for up to 75 s
  deflate   offers permessage-deflate once and prints what the server negotiates, about 3 s

Set PROBE_OUT_DIR to keep raw frames.
Recorded in docs/profiles/woo-x-pro/websocket.md.
"""

import asyncio
import json
import os
import sys
import time
import urllib.request

import websockets

WS = "wss://cloud-ws.wooxpro.com/api?protocol=1.1"
API = "https://cloud-api.wooxpro.com"
OUT = os.environ.get("PROBE_OUT_DIR")


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, default=str), flush=True)


def capture(name, text):
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "a") as f:
            f.write(text + "\n")


def stats(xs):
    if not xs:
        return {"n": 0}
    s = sorted(xs)
    return {"n": len(s), "min": s[0], "p50": s[len(s) // 2], "p90": s[min(len(s) - 1, int(len(s) * 0.9))], "max": s[-1]}


def catalog():
    req = urllib.request.Request(API + "/contract/public/details", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["data"]["symbols"]


def live_symbols(rows):
    return [m["symbol"] for m in rows if m["status"] == "Trading" and float(m["volume_24h"]) > 0]


def frames_for(topics, budget=1800):
    frames, cur = [], []
    for t in topics:
        if cur and len(json.dumps({"action": "subscribe", "args": cur + [t]})) > budget:
            frames.append(cur)
            cur = []
        cur.append(t)
    if cur:
        frames.append(cur)
    return frames


async def connect(compression=None):
    t0 = time.perf_counter()
    ws = await websockets.connect(WS, compression=compression, max_size=None, ping_interval=None, open_timeout=15)
    return ws, round((time.perf_counter() - t0) * 1000)


async def book():
    rows = catalog()
    syms = live_symbols(rows)
    topics = [f"futures/depthIncrease50:{s}@100ms" for s in syms]
    ws, open_ms = await connect()
    frames = frames_for(topics)
    for f in frames:
        await ws.send(json.dumps({"action": "subscribe", "args": f}))
    log("book_open", open_ms=open_ms, contracts=len(syms), subscribe_frames=len(frames), largest_frame_bytes=max(len(json.dumps({"action": "subscribe", "args": f})) for f in frames))
    acks, fails = 0, []
    st = {s: {"snap": 0, "upd": 0, "empty_upd": 0, "gaps": 0, "dups": 0, "ver": None, "first": None, "msdt": [], "last_ms": None,
              "snap_bids": None, "snap_asks": None, "order_bad": 0, "zero_vol": 0} for s in syms}
    t0 = time.time()
    keepalive_at = t0 + 15
    while time.time() - t0 < 60:
        try:
            raw = await asyncio.wait_for(ws.recv(), 2)
        except asyncio.TimeoutError:
            continue
        if time.time() > keepalive_at:
            await ws.send('{"action":"ping"}')
            keepalive_at = time.time() + 15
        msg = json.loads(raw)
        if "action" in msg:
            if msg.get("success"):
                acks += 1
            else:
                fails.append(msg)
            continue
        d = msg.get("data")
        if not isinstance(d, dict) or "version" not in d:
            capture("book-other.jsonl", raw[:400])
            continue
        s = st[d["symbol"]]
        if s["first"] is None:
            s["first"] = d["type"]
            capture("book-first.jsonl", raw)
        if s["last_ms"] is not None:
            s["msdt"].append(d["ms_t"] - s["last_ms"])
        s["last_ms"] = d["ms_t"]
        bids, asks = d.get("bids") or [], d.get("asks") or []
        if d["type"] == "snapshot":
            s["snap"] += 1
            s["snap_bids"], s["snap_asks"] = len(bids), len(asks)
            bp, ap = [float(x["price"]) for x in bids], [float(x["price"]) for x in asks]
            s["order_bad"] += (bp != sorted(bp, reverse=True)) + (ap != sorted(ap))
        else:
            s["upd"] += 1
            s["empty_upd"] += not bids and not asks
            s["zero_vol"] += sum(1 for x in bids + asks if x["vol"] == "0")
            if s["ver"] is not None:
                if d["version"] == s["ver"]:
                    s["dups"] += 1
                elif d["version"] != s["ver"] + 1:
                    s["gaps"] += 1
                    capture("book-gaps.jsonl", json.dumps({"symbol": d["symbol"], "had": s["ver"], "got": d["version"]}))
        s["ver"] = d["version"]
    await ws.close()
    alive = {k: v for k, v in st.items() if v["first"]}
    log("book_acks", acks=acks, fails=[(f.get("group"), f.get("error")) for f in fails][:10], fail_count=len(fails))
    log("book_summary", contracts_delivering=len(alive), silent=[k for k, v in st.items() if not v["first"]],
        first_type=dict((t, sum(1 for v in alive.values() if v["first"] == t)) for t in ("snapshot", "update")),
        updates=sum(v["upd"] for v in alive.values()), gaps=sum(v["gaps"] for v in alive.values()), dups=sum(v["dups"] for v in alive.values()),
        snapshots_after_first=sum(max(0, v["snap"] - 1) for v in alive.values()),
        empty_updates=sum(v["empty_upd"] for v in alive.values()), order_bad=sum(v["order_bad"] for v in alive.values()),
        updates_per_contract=stats([v["upd"] for v in alive.values()]), ms_t_step=stats([x for v in alive.values() for x in v["msdt"]]),
        snapshot_levels_bids=stats([v["snap_bids"] for v in alive.values() if v["snap_bids"] is not None]),
        empty_snapshots=[k for k, v in alive.items() if v["snap_bids"] == 0 and v["snap_asks"] == 0],
        one_sided_snapshots=[k for k, v in alive.items() if (v["snap_bids"] == 0) != (v["snap_asks"] == 0)])
    for sym in ["BTCUSDT", "ETHUSDT", "BTCUSD", "ASTEROIDETHUSDT"]:
        if sym in st:
            v = st[sym]
            log("book_symbol", symbol=sym, first=v["first"], snap_levels=(v["snap_bids"], v["snap_asks"]), updates=v["upd"], empty=v["empty_upd"],
                gaps=v["gaps"], ms_t_step=stats(v["msdt"]))


async def recv_for(ws, seconds, sink):
    t0 = time.time()
    while time.time() - t0 < seconds:
        try:
            raw = await asyncio.wait_for(ws.recv(), max(0.1, seconds - (time.time() - t0)))
        except asyncio.TimeoutError:
            break
        except websockets.ConnectionClosed as e:
            sink.append(("closed", time.time() - t0, e.rcvd.code if e.rcvd else None, e.rcvd.reason if e.rcvd else None))
            break
        sink.append((raw, time.time() - t0, None, None))


async def channels():
    ws, open_ms = await connect()
    log("channels_open", open_ms=open_ms)
    topics = ["futures/depth50:BTCUSDT@100ms", "futures/depthAll50:BTCUSDT@100ms", "futures/depthIncrease20:BTCUSDT@200ms",
              "futures/bookticker:BTCUSDT", "futures/ticker:BTCUSDT", "futures/fundingRate:BTCUSDT", "futures/trade:BTCUSDT"]
    await ws.send(json.dumps({"action": "subscribe", "args": topics}))
    sink = []
    await recv_for(ws, 12, sink)
    by = {}
    for raw, t, _, _ in sink:
        if raw == "closed":
            continue
        m = json.loads(raw)
        key = m.get("group") if "action" not in m else "ack:" + str(m.get("group"))
        by.setdefault(key, []).append((round(t, 2), raw))
    for k, v in by.items():
        log("channel", group=k, frames=len(v), arrivals=[x[0] for x in v][:14], sample=v[0][1][:700], second=v[1][1][:400] if len(v) > 1 else None)
    await ws.send(json.dumps({"action": "request", "args": ["futures/depthIncrease20:BTCUSDT@100ms"]}))
    await ws.send(json.dumps({"action": "request", "args": ["futures/fundingRate:ETHUSDT"]}))
    sink = []
    await recv_for(ws, 3, sink)
    for raw, t, _, _ in sink:
        log("request_reply", t=round(t, 2), frame=str(raw)[:500])
    rows = catalog()
    delisted = next(m["symbol"] for m in rows if m["status"] == "Delisted")
    quiet = next((m["symbol"] for m in rows if m["status"] == "Trading" and float(m["volume_24h"]) == 0 and not m.get("tradfi_info")), None)
    bad = [f"futures/depthIncrease50:NOPEUSDT@100ms", f"futures/depthIncrease50:{delisted}@100ms", "futures/depthIncrease50:BTCUSDT@50ms",
           "futures/depth30:BTCUSDT", "futures/nothing:BTCUSDT", "futures/depthIncrease50:btcusdt@100ms", f"futures/depthIncrease50:{quiet}@100ms"]
    for t in bad:
        await ws.send(json.dumps({"action": "subscribe", "args": [t]}))
    await ws.send("not json")
    await ws.send('{"action":"ping"}')
    await ws.send("ping")
    sink = []
    await recv_for(ws, 4, sink)
    for raw, t, code, reason in sink:
        if raw == "closed":
            log("closed", t=round(t, 2), code=code, reason=reason)
            continue
        if "BTCUSDT" in raw and "success" not in raw:
            continue
        log("error_case", t=round(t, 2), frame=raw[:500])
    log("quiet_symbol", symbol=quiet, delisted=delisted)
    await ws.close()


async def ticker():
    ws, open_ms = await connect()
    await ws.send(json.dumps({"action": "subscribe", "args": ["futures/ticker"]}))
    per, frames, t0 = {}, 0, time.time()
    sample = None
    while time.time() - t0 < 40:
        try:
            raw = await asyncio.wait_for(ws.recv(), 2)
        except asyncio.TimeoutError:
            continue
        m = json.loads(raw)
        if "action" in m:
            log("ticker_ack", frame=raw[:300])
            continue
        d = m.get("data") or {}
        if "symbol" not in d:
            continue
        frames += 1
        sample = sample or raw
        p = per.setdefault(d["symbol"], {"t": [], "mark": [], "index": [], "last": []})
        p["t"].append(time.time())
        p["mark"].append(d.get("mark_price"))
        p["index"].append(d.get("index_price"))
        p["last"].append(d.get("last_price"))
    await ws.close()
    rows = catalog()
    live = set(live_symbols(rows))
    trading = {m["symbol"] for m in rows if m["status"] == "Trading"}
    gaps = [round((b - a) * 1000) for p in per.values() for a, b in zip(p["t"], p["t"][1:])]
    live_gaps = [round(max(b - a for a, b in zip(p["t"], p["t"][1:])) * 1000) for s, p in per.items() if s in live and len(p["t"]) > 1]
    mark_idx = [abs(float(p["mark"][-1]) - float(p["index"][-1])) / float(p["index"][-1]) * 1e6 for s, p in per.items()
                if s in live and p["mark"][-1] and float(p["index"][-1] or 0) > 0]
    mark_eq_last = sum(1 for s, p in per.items() if s in live and p["mark"][-1] == p["last"][-1])
    mark_zero = [s for s, p in per.items() if any(x in (None, "", "0") for x in p["mark"])]
    log("ticker_summary", open_ms=open_ms, frames=frames, frames_per_s=round(frames / 40, 1), contracts=len(per),
        trading_covered=len(trading & set(per)), live_covered=len(live & set(per)), live_missing=sorted(live - set(per)),
        not_trading=sorted(set(per) - trading)[:10], interval_ms=stats(gaps), max_interval_per_live_contract_ms=stats(live_gaps),
        mark_vs_index_ppm_live=stats([round(x) for x in mark_idx]), mark_equals_last_live=mark_eq_last, mark_zero_or_missing=mark_zero[:10],
        mark_changes_live=stats([sum(1 for a, b in zip(p["mark"], p["mark"][1:]) if a != b) for s, p in per.items() if s in live]),
        index_changes_live=stats([sum(1 for a, b in zip(p["index"], p["index"][1:]) if a != b) for s, p in per.items() if s in live]),
        sample=sample[:500] if sample else None)
    for s in ["BTCUSDT", "ETHUSDT", "BTCUSD"]:
        p = per.get(s)
        if p:
            log("ticker_symbol", symbol=s, frames=len(p["t"]), last=(p["mark"][-1], p["index"][-1], p["last"][-1]))


async def framecap():
    rows = catalog()
    syms = [m["symbol"] for m in rows if m["status"] == "Trading"]
    for size in [1000, 1800, 2000, 2100, 2200, 3000, 4000, 4500]:
        args = []
        for s in syms:
            if len(json.dumps({"action": "subscribe", "args": args + [f"futures/bookticker:{s}"]})) > size:
                break
            args.append(f"futures/bookticker:{s}")
        frame = json.dumps({"action": "subscribe", "args": args})
        ws, _ = await connect()
        t0 = time.time()
        await ws.send(frame)
        sink = []
        await recv_for(ws, 2.5, sink)
        acks = sum(1 for r, *_ in sink if r != "closed" and '"success":true' in r)
        closed = next(((c, rs) for r, _, c, rs in sink if r == "closed"), None)
        log("framecap", bytes=len(frame), topics=len(args), acks=acks, frames=len(sink), closed=closed)
        await ws.close()
        await asyncio.sleep(0.5)


async def silence():
    async def one(label, subscribe, send):
        ws, open_ms = await connect()
        if subscribe:
            await ws.send(json.dumps({"action": "subscribe", "args": [subscribe]}))
        t0, frames, pongs, closed = time.time(), 0, [], None
        next_send = t0 + 10
        while time.time() - t0 < 75:
            if send and time.time() >= next_send:
                ts = time.time()
                if send == "protocol":
                    waiter = await ws.ping()
                    try:
                        await asyncio.wait_for(waiter, 5)
                        pongs.append(round((time.time() - ts) * 1000))
                    except asyncio.TimeoutError:
                        pongs.append(None)
                else:
                    await ws.send(send)
                next_send = time.time() + 10
            try:
                raw = await asyncio.wait_for(ws.recv(), 1)
                frames += 1
                if "pong" in str(raw) and send not in (None, "protocol"):
                    pongs.append(str(raw)[:80])
            except asyncio.TimeoutError:
                pass
            except websockets.ConnectionClosed as e:
                closed = (round(time.time() - t0, 1), e.rcvd.code if e.rcvd else None, e.rcvd.reason if e.rcvd else None)
                break
        log("silence", label=label, open_ms=open_ms, frames=frames, closed=closed, pongs=pongs[:4], held_s=round(time.time() - t0, 1))
        if not closed:
            await ws.close()

    rows = catalog()
    quiet = next((m["symbol"] for m in rows if m["status"] == "Trading" and float(m["volume_24h"]) == 0 and not m.get("tradfi_info")), "BTCUSD")
    await asyncio.gather(
        one("never subscribes, never sends", None, None),
        one(f"subscribes a quiet book {quiet}, never sends", f"futures/depthIncrease50:{quiet}@100ms", None),
        one("subscribes funding rate, sends json ping every 10 s", "futures/fundingRate:BTCUSDT", '{"action":"ping"}'),
        one("subscribes funding rate, sends text ping every 10 s", "futures/fundingRate:BTCUSDT", "ping"),
        one("subscribes funding rate, sends protocol ping every 10 s", "futures/fundingRate:BTCUSDT", "protocol"),
    )


async def deflate():
    ws, open_ms = await connect(compression="deflate")
    ext = ws.response.headers.get("Sec-WebSocket-Extensions")
    await ws.close()
    log("deflate_offered", open_ms=open_ms, negotiated=ext)
    ws, open_ms = await connect()
    log("deflate_not_offered", open_ms=open_ms, negotiated=ws.response.headers.get("Sec-WebSocket-Extensions"), server=ws.response.headers.get("Server"))
    await ws.close()


MODES = {"book": book, "channels": channels, "ticker": ticker, "framecap": framecap, "silence": silence, "deflate": deflate}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "book"
    log("run", mode=mode, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), websockets=websockets.__version__)
    asyncio.run(MODES[mode]())
