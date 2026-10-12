# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""Tebbit futures WebSocket probe for docs/profiles/tebbit/websocket.md.

Public, unauthenticated and read-only.
The protocol is the one the website bundle speaks: {"req": "sub_symbol", "symbol": "btc_usdt"} on wss://tebbit.io/ws/market.
It holds sockets for about 4.5 socket minutes in total, in this order:
  A. 20 s on btc_usdt: channels, the full book, the per level deltas, ids, and a rebuild of each full book from the one before.
  B. about 20 s of control frames on one socket: a second symbol, unsub, unknown and malformed requests, and a non JSON frame last.
  C. 15 s of the two bulk channels, sub_tickers and sub_mark_prices.
  D. 10 s on 8 sockets at once, one symbol each, the first four and the last four of the catalog.
  E. 65 s on two sockets at once, one sending no ping, one sending a text ping every 10 s.
Run from the repository root with: uv run scripts/probes/venues/tebbit/ws-probe.py
"""

import asyncio
import collections
import json
import pathlib
import statistics
import time
import urllib.request

import websockets

URL = "wss://tebbit.io/ws/market"
REST = "https://tebbit.io/futures/fapi/market/v1/public"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "tebbit"
WORK.mkdir(parents=True, exist_ok=True)


def rest(path):
    req = urllib.request.Request(REST + path, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["data"]


def connect():
    return websockets.connect(URL, compression=None, open_timeout=10, ping_interval=None, max_size=None)


async def recv_for(ws, secs, sink):
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
            return e
        sink.append((time.time(), m))


def parse(m):
    try:
        return json.loads(m)
    except (TypeError, ValueError):
        return None


def rebuild_check(frames):
    """Apply the deltas between two full books to the first and compare with the second."""
    fulls = [(i, f) for i, f in enumerate(frames) if f["channel"] == "push.deep.full"]
    results = []
    for (i0, f0), (i1, f1) in zip(fulls, fulls[1:]):
        bids = {p: q for p, q in f0["data"]["b"]}
        asks = {p: q for p, q in f0["data"]["a"]}
        id0 = int(f0["data"]["id"])
        applied = 0
        for f in frames[i0 + 1:i1]:
            if f["channel"] != "push.deep":
                continue
            d = f["data"]
            if int(d["id"]) <= id0:
                continue
            side = bids if d["ba"] == 1 else asks
            if float(d["q"]) == 0:
                side.pop(d["p"], None)
            else:
                side[d["p"]] = d["q"]
            applied += 1
        top = lambda book, rev: sorted(((float(p), float(q)) for p, q in book.items()), reverse=rev)[:20]
        want_b = sorted(((float(p), float(q)) for p, q in f1["data"]["b"]), reverse=True)[:20]
        want_a = sorted(((float(p), float(q)) for p, q in f1["data"]["a"]))[:20]
        results.append((applied, top(bids, True) == want_b, top(asks, False) == want_a))
    return results


async def part_a():
    print("== A. 20 s on btc_usdt")
    sink = []
    async with connect() as ws:
        t_open = time.time()
        await ws.send(json.dumps({"req": "sub_symbol", "symbol": "btc_usdt"}))
        snap_task = asyncio.get_running_loop().run_in_executor(None, rest, "/q/depth?symbol=btc_usdt&level=1000")
        await recv_for(ws, 20, sink)
        snap = await snap_task
    texts = [m for _, m in sink if parse(m) is None or not isinstance(parse(m), dict)]
    frames = [parse(m) for _, m in sink if isinstance(parse(m), dict)]
    arrivals = [t for t, m in sink if isinstance(parse(m), dict)]
    print(f"  text frames: {collections.Counter(texts)}")
    print(f"  first frame {sink[0][0] - t_open:.2f} s after open, channels {dict(collections.Counter(f['channel'] for f in frames))}")
    fulls = [(t, f) for t, f in zip(arrivals, frames) if f["channel"] == "push.deep.full"]
    gaps = [b[0] - a[0] for a, b in zip(fulls, fulls[1:])]
    print(f"  push.deep.full: {len(fulls)} frames, interval median {statistics.median(gaps):.2f} s, min {min(gaps):.2f}, max {max(gaps):.2f}")
    nb = [len(f["data"]["b"]) for _, f in fulls]
    na = [len(f["data"]["a"]) for _, f in fulls]
    print(f"  push.deep.full levels: bids {min(nb)} to {max(nb)}, asks {min(na)} to {max(na)}, keys {sorted(fulls[0][1]['data'])}")
    f0 = fulls[0][1]["data"]
    bdesc = all(float(f0["b"][i][0]) > float(f0["b"][i + 1][0]) for i in range(len(f0["b"]) - 1))
    aasc = all(float(f0["a"][i][0]) < float(f0["a"][i + 1][0]) for i in range(len(f0["a"]) - 1))
    print(f"  first full book: bids descending {bdesc}, asks ascending {aasc}, best bid {f0['b'][0]}, best ask {f0['a'][0]}, id {f0['id']}")
    sci = sum("E" in q for _, f in fulls for _, q in f["data"]["b"] + f["data"]["a"])
    tot = sum(len(f["data"]["b"]) + len(f["data"]["a"]) for _, f in fulls)
    sample = [q for _, f in fulls for _, q in f["data"]["b"] + f["data"]["a"] if "E" in q][:5]
    print(f"  sizes in E notation in full books: {sci} of {tot}, for example {sample}")
    deltas = [f["data"] for f in frames if f["channel"] == "push.deep"]
    ids = [int(d["id"]) for d in deltas]
    inc = sum(b > a for a, b in zip(ids, ids[1:]))
    steps = [b - a for a, b in zip(ids, ids[1:])]
    print(f"  push.deep: {len(deltas)} frames, keys {sorted(deltas[0])}, ba values {dict(collections.Counter(d['ba'] for d in deltas))}, zero size {sum(float(d['q']) == 0 for d in deltas)}")
    print(f"  push.deep ids strictly increasing on {inc} of {len(ids) - 1} steps, step of exactly 1 on {sum(s == 1 for s in steps)}, median step {statistics.median(steps):.0f}")
    bid_px = max(float(p) for p, _ in f0["b"])
    ba1 = [float(d["p"]) for d in deltas if d["ba"] == 1 and float(d["q"]) > 0]
    ba2 = [float(d["p"]) for d in deltas if d["ba"] == 2 and float(d["q"]) > 0]
    if ba1 and ba2:
        print(f"  ba 1 prices median {statistics.median(ba1)}, ba 2 prices median {statistics.median(ba2)}, first full best bid {bid_px}")
    stamps = collections.Counter(d["t"] for d in deltas)
    print(f"  push.deep frames per distinct t: median {statistics.median(stamps.values())}, max {max(stamps.values())}")
    full_ids = [int(f["data"]["id"]) for _, f in fulls]
    print(f"  full book ids increasing {all(b > a for a, b in zip(full_ids, full_ids[1:]))}, REST snapshot u {snap['u']} with {len(snap['b'])} bids and {len(snap['a'])} asks")
    res = rebuild_check(frames)
    print(f"  rebuild of each full book from the one before, top 20 levels: {sum(1 for _, b, a in res if b and a)} of {len(res)} matched, deltas applied per step {[r[0] for r in res][:12]}")
    lag = {}
    for t, f in zip(arrivals, frames):
        d = f.get("data")
        if isinstance(d, dict) and "t" in d:
            lag.setdefault(f["channel"], []).append(t * 1000 - d["t"])
    for ch, xs in sorted(lag.items()):
        print(f"  arrival minus t, local clock, {ch}: median {statistics.median(xs):.0f} ms over {len(xs)}")
    for ch in ("push.mark.price", "push.index.price", "push.agg.ticker"):
        ts = [t for t, f in zip(arrivals, frames) if f["channel"] == ch]
        if len(ts) > 1:
            print(f"  {ch}: {len(ts)} frames in 20 s, example {json.dumps(next(f for f in frames if f['channel'] == ch))[:220]}")
    (WORK / "ws-a-frames.json").write_text(json.dumps(frames[:400]))
    return [json.dumps(next(f for f in frames if f["channel"] == c))[:400] for c in ("push.deep.full", "push.deep")]


async def part_b():
    print("== B. control frames")
    async with connect() as ws:
        steps = [
            ("sub btc then eth", [{"req": "sub_symbol", "symbol": "btc_usdt"}, {"req": "sub_symbol", "symbol": "eth_usdt"}], 4),
            ("unsub_symbol", [{"req": "unsub_symbol"}], 3),
            ("unknown symbol", [{"req": "sub_symbol", "symbol": "nope_usdt"}], 3),
            ("upper case symbol", [{"req": "sub_symbol", "symbol": "BTC_USDT"}], 3),
            ("sub_symbol without symbol", [{"req": "sub_symbol"}], 2),
            ("unknown req", [{"req": "bogus"}], 2),
            ("non ASCII symbol", [{"req": "sub_symbol", "symbol": "龙虾_usdt"}], 3),
            ("text ping", ["ping"], 2),
            ("non JSON text", ["notjson"], 3),
        ]
        for name, frames, secs in steps:
            for f in frames:
                try:
                    await ws.send(f if isinstance(f, str) else json.dumps(f, ensure_ascii=False))
                except websockets.ConnectionClosed as e:
                    print(f"  {name}: send failed, closed {e.rcvd}")
                    return
            sink = []
            closed = await recv_for(ws, secs, sink)
            texts = collections.Counter(m for _, m in sink if not isinstance(parse(m), dict))
            syms = collections.Counter((parse(m)["channel"], (parse(m).get("data") or {}).get("s")) for _, m in sink if isinstance(parse(m), dict) and isinstance(parse(m).get("data"), dict))
            per_sym = collections.Counter(s for (_, s) in syms.elements())
            print(f"  {name}: texts {dict(texts)}, frames per symbol {dict(per_sym)}" + (f", then closed code {closed.rcvd.code if closed.rcvd else None} {closed}" if closed else ""))
            if closed:
                return


async def part_c():
    print("== C. bulk channels for 15 s")
    sink = []
    async with connect() as ws:
        await ws.send(json.dumps({"req": "sub_tickers"}))
        await ws.send(json.dumps({"req": "sub_mark_prices"}))
        await recv_for(ws, 15, sink)
    by = collections.defaultdict(list)
    for t, m in sink:
        j = parse(m)
        if isinstance(j, dict):
            by[j["channel"]].append((t, j["data"]))
        else:
            by["text " + m].append((t, None))
    for ch, xs in by.items():
        rows = [len(d) for _, d in xs if isinstance(d, list)]
        gaps = [b[0] - a[0] for a, b in zip(xs, xs[1:])]
        print(f"  {ch}: {len(xs)} frames, rows {rows[:6]}, interval median {statistics.median(gaps) if gaps else 0:.2f} s")
    marks = [d for t, d in by.get("push.mark.prices", [])]
    if len(marks) > 1:
        a = {r["s"]: r["p"] for r in marks[0]}
        b = {r["s"]: r["p"] for r in marks[-1]}
        print(f"  mark rows changed between the first and last push.mark.prices frame: {sum(a.get(s) != p for s, p in b.items())} of {len(b)}")


async def part_d(symbols):
    print(f"== D. {len(symbols)} sockets at once, one symbol each")

    async def one(sym):
        sink = []
        try:
            async with connect() as ws:
                await ws.send(json.dumps({"req": "sub_symbol", "symbol": sym}))
                await recv_for(ws, 10, sink)
        except Exception as e:  # noqa: BLE001 - the refusal is the finding
            return sym, f"error {type(e).__name__} {e}"
        frames = [parse(m) for _, m in sink if isinstance(parse(m), dict)]
        fulls = [f["data"] for f in frames if f["channel"] == "push.deep.full"]
        same = sum(1 for a, b in zip(fulls, fulls[1:]) if a["b"] == b["b"] and a["a"] == b["a"])
        same_id = sum(1 for a, b in zip(fulls, fulls[1:]) if a["id"] == b["id"])
        deltas = sum(1 for f in frames if f["channel"] == "push.deep")
        levels = (len(fulls[0]["b"]), len(fulls[0]["a"])) if fulls else None
        return sym, f"{len(frames)} frames, {len(fulls)} full books with {levels} levels, {deltas} deltas, consecutive identical full books {same}, repeated ids {same_id}"

    for sym, r in await asyncio.gather(*(one(s) for s in symbols)):
        print(f"  {sym}: {r}")


async def part_e():
    print("== E. 65 s keepalive test on two sockets")

    async def one(ping):
        sink = []
        t0 = time.time()
        closed = None
        async with connect() as ws:
            await ws.send(json.dumps({"req": "sub_symbol", "symbol": "eth_usdt"}))
            while time.time() - t0 < 65 and closed is None:
                closed = await recv_for(ws, 10, sink)
                if ping and closed is None:
                    await ws.send("ping")
        texts = collections.Counter(m for _, m in sink if not isinstance(parse(m), dict))
        last = sink[-1][0] - t0 if sink else 0
        return ping, len(sink), dict(texts), closed, last

    for ping, n, texts, closed, last in await asyncio.gather(one(False), one(True)):
        label = "text ping every 10 s" if ping else "no client ping"
        print(f"  {label}: {n} frames, texts {texts}, last frame at {last:.0f} s, closed {closed}")


async def main():
    print(f"tebbit ws probe at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    examples = await part_a()
    await part_b()
    await part_c()
    cat = rest("/symbol/list")
    perps = [r["symbol"] for r in cat if r["contractType"] == "PERPETUAL"]
    syms = perps[:4] + perps[-4:]
    await part_d(syms)
    await part_e()
    print("== frame examples")
    for e in examples:
        print("  " + e)


if __name__ == "__main__":
    asyncio.run(main())
