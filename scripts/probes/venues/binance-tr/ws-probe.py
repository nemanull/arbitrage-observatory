# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=14,<16"]
# ///
"""Binance TR WebSocket probe for docs/profiles/binance-tr/websocket.md.

Public, unauthenticated and read-only.
It holds sockets open for about 4 minutes of wall time in total.
  A. 195 s on wss://stream-cloud.binance.tr/stream with btctry@depth@100ms, btctry@depth20@100ms and ethtry@depth@100ms.
     It checks the U and u chain of each diff stream, syncs BTCTRY to a REST snapshot by the documented rule,
     compares the synced book with each depth20 frame at the same update id, counts identical repeats,
     and logs every server ping frame, which the docs say comes every 3 minutes.
  A2. 20 s of btctry@depth20@100ms read at once from the TR host and from Binance's own wss://stream.binance.com:9443,
     to see whether the two hosts carry one book.
  B. About 25 s of session checks on fresh sockets: subscribe acknowledgement, LIST_SUBSCRIPTIONS, an unknown symbol,
     a bad method, invalid JSON, a non TRY symbol, permessage-deflate negotiation, and the handshake of the other hosts
     the docs and the web app name.
Run from the repository root with: uv run scripts/probes/venues/binance-tr/ws-probe.py
Captured frames go to .claude/survey-work/binance-tr/ws-capture.jsonl.
"""

import asyncio
import email.utils
import json
import logging
import pathlib
import statistics
import time
import urllib.request

from websockets.asyncio.client import connect

TR = "wss://stream-cloud.binance.tr"
GLOBAL = "wss://stream.binance.com:9443"
REST = "https://api.binance.me/api/v3/depth?symbol=BTCTRY&limit=1000"
OUT = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "binance-tr" / "ws-capture.jsonl"
PINGS = []


class PingLog(logging.Handler):
    def emit(self, record):
        msg = record.getMessage()
        if "PING" in msg or "PONG" in msg or "CLOSE" in msg:
            PINGS.append((time.time(), msg[:120]))


def cap(fh, section, direction, data):
    fh.write(json.dumps({"t": time.time(), "section": section, "dir": direction, "data": data}) + "\n")


def snapshot():
    req = urllib.request.Request(REST, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read())


def apply(side, levels):
    for p, q in levels:
        if float(q) == 0:
            side.pop(p, None)
        else:
            side[p] = q


def top(side, n, reverse):
    keys = sorted(side, key=float, reverse=reverse)[:n]
    return [[k, side[k]] for k in keys]


async def section_a(fh):
    print("== A. Book streams on stream-cloud.binance.tr, 195 s")
    url = f"{TR}/stream?streams=btctry@depth@100ms/btctry@depth20@100ms/ethtry@depth@100ms"
    t_start = time.time()
    counts, last_u, gaps, chain_ok = {}, {}, {}, {}
    arrivals = {}
    d20_prev, d20_repeat, d20_frames, d20_levels = None, 0, 0, set()
    d20_tr = {}
    buf, book, synced, sync_note = [], None, False, None
    snap_task = None
    match = mismatch = 0
    first = {}
    async with connect(url, compression=None, ping_interval=None) as ws:
        print(f"connected, extensions {ws.response.headers.get('Sec-WebSocket-Extensions')}")
        while time.time() - t_start < 195:
            try:
                raw = await asyncio.wait_for(ws.recv(), timeout=10)
            except asyncio.TimeoutError:
                print("10 s with no frame")
                continue
            now = time.time()
            m = json.loads(raw)
            stream, d = m["stream"], m["data"]
            counts[stream] = counts.get(stream, 0) + 1
            arrivals.setdefault(stream, []).append(now)
            if stream not in first:
                first[stream] = d
                cap(fh, "A", "in", m)
            if stream.endswith("@depth@100ms"):
                if stream in last_u:
                    if d["U"] == last_u[stream] + 1:
                        chain_ok[stream] = chain_ok.get(stream, 0) + 1
                    else:
                        gaps[stream] = gaps.get(stream, 0) + 1
                last_u[stream] = d["u"]
                if stream.startswith("btctry"):
                    if snap_task is None and now - t_start > 2:
                        snap_task = asyncio.create_task(asyncio.to_thread(snapshot))
                    if not synced:
                        buf.append(d)
                        if snap_task is not None and snap_task.done():
                            s = snap_task.result()
                            L = s["lastUpdateId"]
                            book = ({p: q for p, q in s["bids"]}, {p: q for p, q in s["asks"]})
                            kept = [e for e in buf if e["u"] > L]
                            ok = bool(kept) and kept[0]["U"] <= L + 1 <= kept[0]["u"]
                            sync_note = f"snapshot lastUpdateId {L}, buffered {len(buf)}, dropped {len(buf) - len(kept)}, first kept U {kept[0]['U'] if kept else None} u {kept[0]['u'] if kept else None}, rule holds {ok}"
                            for e in kept:
                                apply(book[0], e["b"])
                                apply(book[1], e["a"])
                            synced = ok
                            book_u = kept[-1]["u"] if kept else L
                    else:
                        apply(book[0], d["b"])
                        apply(book[1], d["a"])
                        book_u = d["u"]
                        if book_u in d20_tr:
                            b20, a20 = d20_tr.pop(book_u)
                            if b20 == top(book[0], 20, True) and a20 == top(book[1], 20, False):
                                match += 1
                            else:
                                mismatch += 1
            elif stream == "btctry@depth20@100ms":
                d20_frames += 1
                d20_levels.add((len(d["bids"]), len(d["asks"])))
                key = (d["lastUpdateId"], json.dumps(d["bids"]), json.dumps(d["asks"]))
                if key == d20_prev:
                    d20_repeat += 1
                d20_prev = key
                d20_tr[d["lastUpdateId"]] = (d["bids"], d["asks"])
                if synced and d["lastUpdateId"] == book_u:
                    d20_tr.pop(d["lastUpdateId"])
                    if d["bids"] == top(book[0], 20, True) and d["asks"] == top(book[1], 20, False):
                        match += 1
                    else:
                        mismatch += 1
                if len(d20_tr) > 400:
                    d20_tr.pop(next(iter(d20_tr)))
    span = time.time() - t_start
    print(f"held {span:.0f} s")
    for s, n in counts.items():
        gapsec = [b - a for a, b in zip(arrivals[s], arrivals[s][1:])]
        print(f"{s}: {n} frames, median gap {statistics.median(gapsec) * 1000:.0f} ms, p95 {sorted(gapsec)[int(len(gapsec) * 0.95)] * 1000:.0f} ms, max {max(gapsec) * 1000:.0f} ms")
    for s in last_u:
        print(f"{s}: U equals previous u plus 1 on {chain_ok.get(s, 0)} frames, gaps {gaps.get(s, 0)}")
    print(f"BTCTRY sync: {sync_note}")
    print(f"synced book against depth20 at the same update id: {match} equal, {mismatch} different, {len(d20_tr)} depth20 ids never met by a diff u")
    print(f"depth20 frames {d20_frames}, level counts {sorted(d20_levels)}, identical consecutive repeats {d20_repeat}")
    print("first depth frame keys", sorted(first.get("btctry@depth@100ms", {}).keys()), "first depth20 keys", sorted(first.get("btctry@depth20@100ms", {}).keys()))
    print(f"server ping and close frames seen: {[(round(t - t_start, 1), m) for t, m in PINGS if 'PING' in m or 'CLOSE' in m]}")
    print(f"our pong frames: {[(round(t - t_start, 1), m) for t, m in PINGS if 'PONG' in m]}")


async def compare_hosts(fh):
    print("== A2. Same depth20 frames on both hosts, 20 s side by side")
    tr, gl = {}, {}

    async def read(url, store, stop_at):
        async with connect(url, compression=None) as ws:
            while time.time() < stop_at:
                try:
                    d = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                except asyncio.TimeoutError:
                    continue
                store[d["lastUpdateId"]] = (d["bids"], d["asks"], time.time())

    stop = time.time() + 20
    await asyncio.gather(read(f"{TR}/ws/btctry@depth20@100ms", tr, stop), read(f"{GLOBAL}/ws/btctry@depth20@100ms", gl, stop))
    common = set(tr) & set(gl)
    same = sum(1 for k in common if tr[k][:2] == gl[k][:2])
    lag = [(tr[k][2] - gl[k][2]) * 1000 for k in common]
    print(f"TR frames {len(tr)}, Binance frames {len(gl)}, update ids in both {len(common)}, identical levels at those ids {same}")
    if lag:
        print(f"arrival on TR minus arrival on Binance: median {statistics.median(lag):.0f} ms, min {min(lag):.0f}, max {max(lag):.0f}")


async def exchange(ws, frame, wait=3.0):
    if frame is not None:
        await ws.send(frame)
    out = []
    end = time.time() + wait
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.05, end - time.time()))
        except asyncio.TimeoutError:
            break
        d = json.loads(raw)
        if "result" in d or "error" in d or "code" in d:
            out.append(d)
    return out


async def section_b(fh):
    print("== B. Session checks")
    async with connect(f"{TR}/ws", compression=None) as ws:
        for name, frame in (("subscribe", json.dumps({"method": "SUBSCRIBE", "params": ["btctry@depth20@100ms"], "id": 1})),
                            ("list", json.dumps({"method": "LIST_SUBSCRIPTIONS", "id": 2})),
                            ("unknown symbol", json.dumps({"method": "SUBSCRIBE", "params": ["nopetry@depth@100ms"], "id": 3})),
                            ("list again", json.dumps({"method": "LIST_SUBSCRIPTIONS", "id": 4})),
                            ("non TRY symbol", json.dumps({"method": "SUBSCRIBE", "params": ["btcusdt@depth5"], "id": 5})),
                            ("bad method", json.dumps({"method": "SUBSCRIBEX", "params": ["btctry@depth"], "id": 6})),
                            ("invalid JSON", "{not json")):
            try:
                res = await exchange(ws, frame)
                print(f"{name}: {res}")
                cap(fh, "B", "in", {"name": name, "frames": res})
            except Exception as e:
                print(f"{name}: socket ended {type(e).__name__}: {e}")
                break
    async with connect(f"{TR}/ws/btcusdt@depth5", compression=None) as ws:
        d = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
        print(f"btcusdt@depth5 on the TR host: lastUpdateId {d.get('lastUpdateId')} bid {d['bids'][0]}")
    async with connect(f"{TR}/ws/nopetry@depth@100ms", compression=None) as ws:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=5)
            print(f"raw stream of an unknown symbol: {raw[:120]}")
        except asyncio.TimeoutError:
            print("raw stream of an unknown symbol: open, no frame in 5 s")
    async with connect(f"{TR}/ws/btctry@depth20@100ms") as ws:
        print(f"default client offer, server extensions: {ws.response.headers.get('Sec-WebSocket-Extensions')}")
    for url in ("wss://stream-tr.2meta.app/stream?streams=btctry@depth20", "wss://stream-tr.2meta.app/ws/btctry@depth20",
                "wss://www.binance.tr/ws/btctry@depth20", "wss://ws-api.binance.tr:443/ws-api/v3"):
        try:
            async with connect(url, compression=None, open_timeout=10) as ws:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=4)
                    print(f"{url}: open, first frame {str(raw)[:120]}")
                except asyncio.TimeoutError:
                    print(f"{url}: open, no frame in 4 s")
        except Exception as e:
            print(f"{url}: {type(e).__name__}: {str(e)[:160]}")


async def main():
    print(f"run at {email.utils.formatdate(usegmt=True)}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.touch()
    lg = logging.getLogger("websockets.client")
    lg.setLevel(logging.DEBUG)
    lg.addHandler(PingLog())
    with open(OUT, "a") as fh:
        await section_a(fh)
        await compare_hosts(fh)
        await section_b(fh)


if __name__ == "__main__":
    asyncio.run(main())
