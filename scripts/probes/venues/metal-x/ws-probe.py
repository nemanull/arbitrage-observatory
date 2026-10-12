# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""Read-only public WebSocket probe for Metal X at wss://dex.api.mainnet.metalx.com/dexws.

The socket and its frames are not documented.
The URL and the subscribe frame come from the Metal X web app bundle, see docs/profiles/metal-x/websocket.md.

Modes, all by default, or name some on the command line:
    bundle   fetches the web app at https://app.metalx.com, follows its entry script to the chunk that names the socket,
             and prints the socket URL, the subscribe and unsubscribe frames, the topic names and the event names the app handles.
    book     one socket for 120 s with ORDERS and TRADES on XPR_XMD and XBTC_XMD, each with startBlock set to the REST depth sync.
             It reports the acknowledgements, the topic spelling on data frames, the market ids per topic, statuses and order types,
             the seq and block_num runs, frames a second, and frames from before startBlock.
             It rebuilds each book from the REST snapshot and the orderbook type order events, the way the web app does,
             and compares the top ten levels a side with a fresh REST snapshot at the end.
    replay   short sockets that subscribe with startBlock 600 blocks back, with no startBlock, and with startBlock 0, counting what arrives in 8 s.
    errors   one short socket that offers permessage-deflate: an unknown symbol, a lowercase symbol, a topic with no symbol, an unknown topic, a repeat subscribe, an unknown event,
             a JSON ping, an unsubscribe, and a protocol ping with its pong time.
             It sends no frame that is not JSON.
             The first run on 2026-10-09 sent the text "this is not json", the server dropped the socket with no close frame,
             and the REST API answered 502 for several seconds, so that case was removed and is never sent again.
    idle     one socket with no subscription, no client traffic and no client pings for up to 150 s, to see whether the server pings or closes it.
    keepalive  one socket with no subscription that sends a protocol ping every 20 s for 80 s, to see whether pings alone keep it open past 60 s.

The client sends no protocol pings except in errors and keepalive, so any other ping logged is the server's.
Total socket time is about 6 minutes, and the flag --short halves the book and idle windows for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/metal-x/ws-probe.py [--short] [mode ...]
"""

import asyncio
import calendar
import json
import logging
import statistics
import sys
import time
import urllib.request
from collections import Counter, defaultdict

import websockets

URL = "wss://dex.api.mainnet.metalx.com/dexws"
REST = "https://dex.api.mainnet.metalx.com/dex/v1"
SCALE = 0.5 if "--short" in sys.argv else 1.0
BOOK_S = 120 * SCALE
IDLE_S = 150 * SCALE
SYMBOLS = {"XPR_XMD": 1, "XBTC_XMD": 2}
STEP = 1000000  # 1 / 0.000001, finer than any price on these two markets
BUY, SELL = 1, 2


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def rest(path: str) -> dict:
    req = urllib.request.Request(f"{REST}/{path}", headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


class PingLog(logging.Handler):
    """Counts protocol pings and pongs that the websockets library logs at debug level."""

    def __init__(self) -> None:
        super().__init__()
        self.lines: list = []

    def emit(self, record: logging.LogRecord) -> None:
        msg = record.getMessage()
        if "PING" in msg or "PONG" in msg or "CLOSE" in msg:
            self.lines.append((round(time.time(), 2), msg[:120]))


PINGS = PingLog()
logging.getLogger("websockets").addHandler(PINGS)
logging.getLogger("websockets").setLevel(logging.DEBUG)


async def connect(compression: str | None = None):
    t0 = time.perf_counter()
    ws = await websockets.connect(URL, open_timeout=15, ping_interval=None, max_size=2**24, compression=compression)
    return ws, round((time.perf_counter() - t0) * 1000, 1)


def snapshot(sym: str) -> tuple[int, dict]:
    j = rest(f"orders/depth?symbol={sym}&step={STEP}&limit=250")
    book = {"bids": {x["level"]: x["bid"] for x in j["data"]["bids"]},
            "asks": {x["level"]: x["bid"] for x in j["data"]["asks"]}}
    return j["sync"], book


def apply(book: dict, r: dict) -> str | None:
    """The web app's rule: only order_type 0 rows touch the book, transfer adds, cancel, update and delete subtract."""
    if r["order_type"] != 0:
        return None
    s = r["quantity_curr"] if r["status"] == "transfer" else r["quantity_change"]
    base = s / r["price"] if r["order_side"] == BUY else s
    side = book["bids"] if r["order_side"] == BUY else book["asks"]
    p = r["price"]
    if r["status"] == "transfer":
        side[p] = side.get(p, 0.0) + base
    elif r["status"] in ("cancel", "update", "delete"):
        if p not in side:
            return "missing level"
        side[p] -= base
        if side[p] <= 1e-9 * max(1.0, base):
            del side[p]
    return None


def top(book: dict, n: int = 10) -> dict:
    return {"bids": sorted(book["bids"].items(), key=lambda x: -x[0])[:n],
            "asks": sorted(book["asks"].items(), key=lambda x: x[0])[:n]}


def compare(mine: dict, theirs: dict) -> dict:
    res = {}
    for side in ("bids", "asks"):
        a, b = mine[side], theirs[side]
        price_match = sum(1 for x, y in zip(a, b) if x[0] == y[0])
        size_match = sum(1 for x, y in zip(a, b) if x[0] == y[0] and abs(x[1] - y[1]) <= 1e-6 * max(1.0, abs(y[1])))
        res[side] = {"levels": len(b), "price_match": price_match, "size_match": size_match,
                     "first_mismatch": next(([x, y] for x, y in zip(a, b) if x != y and abs(x[1] - y[1]) > 1e-6 * max(1.0, abs(y[1]))), None)}
    return res


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


async def mode_bundle() -> None:
    import re

    app = "https://app.metalx.com"
    html = fetch(app)
    entry = re.search(r'src="(/assets/index-[^"]+\.js)"', html).group(1)
    first = fetch(app + entry)
    front = re.search(r'"\./(frontend-[^"]+\.js)"', first).group(1)
    js = fetch(f"{app}/assets/{front}")
    out(mode="bundle", entry=entry, frontend=front, ws_urls=sorted(set(re.findall(r"wss://[A-Za-z0-9./_-]+", js))),
        http_endpoint=re.findall(r"METAL_DEX_HTTP_ENDPOINT:[^,]+,", js)[:1],
        topics=re.findall(r"TRADES=`[A-Z]+`,e\.ORDERS=`[A-Z]+`", js)[:1],
        statuses=re.findall(r"CREATE=`create`[^)]+", js)[:1])
    dex = next(c for c in sorted(set(re.findall(r"assets/(dex-[A-Za-z0-9_-]+\.js)", js))))
    code = fetch(f"{app}/assets/{dex}")
    out(mode="bundle", chunk=dex, bytes=len(code),
        subscribe=re.findall(r"sendPacked\(\{event:`subscribe`[^)]+\)", code)[:1],
        unsubscribe=re.findall(r"sendPacked\(\{event:`unsubscribe`[^)]+\)", code)[:1],
        events_handled=sorted(set(re.findall(r"n===`([a-z]+)`", code))),
        orderbook_only=bool(re.search(r"order_type!==E\.ORDERBOOK\)return", code)),
        reconnect=re.findall(r"minReconnectionDelay:[^}]+", code)[:1],
        fees_table=bool(re.search(r"table:`fees`", code)))


async def mode_book() -> None:
    ws, open_ms = await connect()
    out(mode="book", open_ms=open_ms, headers=dict(ws.response.headers))
    syncs, books = {}, {}
    for sym in SYMBOLS:
        syncs[sym], books[sym] = snapshot(sym)
    out(mode="book", snapshot_sync=syncs, levels={s: {k: len(v) for k, v in b.items()} for s, b in books.items()})
    rid = 1
    for sym in SYMBOLS:
        for topic in ("ORDERS", "TRADES"):
            await ws.send(json.dumps({"event": "subscribe", "data": {"topic": f"{topic}/{sym}", "startBlock": syncs[sym], "requestId": rid}}))
            rid += 1
    t_start = time.time()
    events, topics, mids, statuses, otypes = Counter(), Counter(), defaultdict(Counter), Counter(), Counter()
    seqs, blocks, lag_ms, before_start, missing, samples = [], [], [], [], Counter(), {}
    frames = 0
    final = None  # (sync_end, rest books) once the closing snapshot is taken
    held: list = []
    while True:
        remaining = t_start + BOOK_S + (4 if final else 0) - time.time()
        if remaining <= 0:
            if final is None:
                final = {s: snapshot(s) for s in SYMBOLS}
                continue
            break
        try:
            raw = await asyncio.wait_for(ws.recv(), remaining)
        except asyncio.TimeoutError:
            continue
        frames += 1
        m = json.loads(raw)
        ev = m.get("event")
        events[ev] += 1
        d = m.get("data") or {}
        if ev != "data":
            samples.setdefault(f"event:{ev}", raw[:400])
            continue
        topic, r = d.get("topic"), d.get("result") or {}
        topics[topic] += 1
        kind = "ORDERS" if topic.startswith("ORDERS") else "TRADES"
        mids[kind][r.get("market_id")] += 1
        samples.setdefault(f"{kind}:{topic}", raw[:700])
        bn = int(d["block_num"])
        blocks.append(bn)
        bt = r.get("block_time")
        if bt:
            ts = calendar.timegm(time.strptime(bt[:19], "%Y-%m-%dT%H:%M:%S")) + float("0" + bt[19:23])
            lag_ms.append((time.time() - ts) * 1000)
        sym = next((s for s, i in SYMBOLS.items() if i == r.get("market_id")), None)
        if kind == "ORDERS":
            seqs.append(int(r["seq"]))
            statuses[r["status"]] += 1
            otypes[(r["status"], r["order_type"])] += 1
            if sym and bn <= syncs[sym]:
                before_start.append({"sym": sym, "block_num": bn, "startBlock": syncs[sym], "status": r["status"]})
                continue
            if sym:
                if final and bn > final[sym][0]:
                    held.append(r)
                    continue
                err = apply(books[sym], r)
                if err:
                    missing[f"{sym} {r['status']} side {r['order_side']}"] += 1
    await ws.close()
    gaps = [seqs[i] - seqs[i - 1] for i in range(1, len(seqs))]
    out(mode="book", seconds=BOOK_S, frames=frames, per_second=round(frames / BOOK_S, 2), events=dict(events), topics=dict(topics),
        market_ids={k: dict(v) for k, v in mids.items()}, statuses=dict(statuses),
        status_by_order_type={f"{a}/{b}": c for (a, b), c in sorted(otypes.items())})
    out(mode="book", seq_count=len(seqs), seq_monotonic=all(g > 0 for g in gaps), seq_step_1=sum(1 for g in gaps if g == 1),
        seq_step_min=min(gaps, default=None), seq_step_max=max(gaps, default=None),
        block_monotonic=all(blocks[i] >= blocks[i - 1] for i in range(1, len(blocks))),
        distinct_blocks=len(set(blocks)),
        lag_ms_median=round(statistics.median(lag_ms), 1) if lag_ms else None,
        lag_ms_min=round(min(lag_ms), 1) if lag_ms else None, lag_ms_max=round(max(lag_ms), 1) if lag_ms else None)
    out(mode="book", frames_at_or_before_startBlock=before_start, missing_level_on_subtract=dict(missing), held_after_final=len(held))
    for sym in SYMBOLS:
        sync_end, theirs = final[sym]
        out(mode="book", compare=sym, sync_end=sync_end, result=compare(top(books[sym]), top(theirs)),
            mine_best=[top(books[sym], 1)["bids"], top(books[sym], 1)["asks"]], rest_best=[top(theirs, 1)["bids"], top(theirs, 1)["asks"]])
    for k, v in samples.items():
        out(mode="book", sample=k, frame=v)
    out(mode="book", pings=PINGS.lines[-6:])


async def count_for(ws, seconds: float) -> dict:
    end = time.time() + seconds
    n, blocks, firsts = 0, [], []
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), end - time.time())
        except asyncio.TimeoutError:
            break
        n += 1
        m = json.loads(raw)
        d = m.get("data") or {}
        if m.get("event") == "data":
            blocks.append(int(d["block_num"]))
        if len(firsts) < 2:
            firsts.append(raw[:240])
    return {"frames": n, "data_blocks_min": min(blocks, default=None), "data_blocks_max": max(blocks, default=None), "first": firsts}


async def mode_replay() -> None:
    sync = rest("orders/depth?symbol=XPR_XMD&step=1000000&limit=1")["sync"]
    for label, start in (("600 blocks back", sync - 600), ("no startBlock", None), ("startBlock 0", 0)):
        ws, _ = await connect()
        data = {"topic": "ORDERS/XPR_XMD", "requestId": 7}
        if start is not None:
            data["startBlock"] = start
        await ws.send(json.dumps({"event": "subscribe", "data": data}))
        res = await count_for(ws, 8)
        out(mode="replay", case=label, rest_sync=sync, startBlock=start, **res)
        await ws.close()


async def mode_errors() -> None:
    ws, open_ms = await connect("deflate")
    out(mode="errors", open_ms=open_ms, offered="permessage-deflate", extensions=ws.response.headers.get("sec-websocket-extensions"),
        server=ws.response.headers.get("server"))
    sync = rest("orders/depth?symbol=XPR_XMD&step=1000000&limit=1")["sync"]
    cases = [
        ("unknown symbol", json.dumps({"event": "subscribe", "data": {"topic": "ORDERS/FOO_BAR", "startBlock": sync, "requestId": 11}})),
        ("lowercase symbol", json.dumps({"event": "subscribe", "data": {"topic": "ORDERS/xpr_xmd", "startBlock": sync, "requestId": 12}})),
        ("topic with no symbol", json.dumps({"event": "subscribe", "data": {"topic": "ORDERS", "startBlock": sync, "requestId": 13}})),
        ("unknown topic", json.dumps({"event": "subscribe", "data": {"topic": "DEPTH/XPR_XMD", "startBlock": sync, "requestId": 14}})),
        ("first subscribe", json.dumps({"event": "subscribe", "data": {"topic": "TRADES/XBTC_XMD", "startBlock": sync, "requestId": 15}})),
        ("repeat subscribe", json.dumps({"event": "subscribe", "data": {"topic": "TRADES/XBTC_XMD", "startBlock": sync, "requestId": 16}})),
        ("unknown event", json.dumps({"event": "hello", "data": {"requestId": 17}})),
        ("json ping", json.dumps({"event": "ping"})),
        ("unsubscribe", json.dumps({"event": "unsubscribe", "data": {"topic": "TRADES/XBTC_XMD", "requestId": 18}})),
    ]
    for label, frame in cases:
        if ws.state.name != "OPEN":
            out(mode="errors", case=label, skipped="socket closed", close_code=ws.close_code, close_reason=ws.close_reason)
            continue
        await ws.send(frame)
        got = []
        end = time.time() + 3
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(ws.recv(), end - time.time())
            except asyncio.TimeoutError:
                break
            except websockets.ConnectionClosed as e:
                got.append(f"closed {e.rcvd.code if e.rcvd else None} {e.rcvd.reason if e.rcvd else ''}")
                break
            m = json.loads(raw) if raw.startswith("{") else raw
            if isinstance(m, dict) and m.get("event") == "data":
                got.append(f"data {m['data'].get('topic')}")
            else:
                got.append(raw[:240])
        out(mode="errors", case=label, sent=frame[:160], replies=got[:6], reply_count=len(got))
    if ws.state.name == "OPEN":
        t0 = time.perf_counter()
        pong = await ws.ping()
        await asyncio.wait_for(pong, 10)
        out(mode="errors", case="protocol ping", pong_ms=round((time.perf_counter() - t0) * 1000, 1))
        await ws.close()


async def mode_idle() -> None:
    PINGS.lines.clear()
    ws, _ = await connect()
    t0 = time.time()
    reason = "window ended"
    try:
        while time.time() - t0 < IDLE_S:
            try:
                raw = await asyncio.wait_for(ws.recv(), IDLE_S - (time.time() - t0))
                out(mode="idle", at_s=round(time.time() - t0, 1), frame=raw[:200])
            except asyncio.TimeoutError:
                break
    except websockets.ConnectionClosed as e:
        reason = f"closed by server at {round(time.time() - t0, 1)} s, code {e.rcvd.code if e.rcvd else None}"
    out(mode="idle", seconds=IDLE_S, result=reason, protocol_frames=[(round(t - t0, 1), m) for t, m in PINGS.lines])
    await ws.close()


async def mode_keepalive() -> None:
    ws, _ = await connect()
    t0 = time.time()
    pongs, reason = [], "open at the end"
    try:
        while time.time() - t0 < 80:
            p0 = time.perf_counter()
            await asyncio.wait_for(await ws.ping(), 10)
            pongs.append(round((time.perf_counter() - p0) * 1000, 1))
            try:
                raw = await asyncio.wait_for(ws.recv(), 20)
                out(mode="keepalive", frame=raw[:200])
            except asyncio.TimeoutError:
                pass
    except websockets.ConnectionClosed as e:
        reason = f"closed by server at {round(time.time() - t0, 1)} s, code {e.rcvd.code if e.rcvd else None}"
    out(mode="keepalive", seconds=round(time.time() - t0, 1), ping_every_s=20, pong_ms=pongs, result=reason)
    await ws.close()


MODES = {"bundle": mode_bundle, "book": mode_book, "replay": mode_replay, "errors": mode_errors, "idle": mode_idle, "keepalive": mode_keepalive}

if __name__ == "__main__":
    chosen = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    for m in chosen:
        asyncio.run(MODES[m]())
