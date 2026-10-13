# /// script
# requires-python = ">=3.11"
# dependencies = ["aiohttp>=3.9"]
# ///
"""Read-only probe of the Extended public WebSocket streams (CCXT id extended).

Every stream is its own URL under wss://api.starknet.extended.exchange/stream.extended.exchange/v1, and nothing is sent to subscribe.
aiohttp runs with autoping off, so the probe sees the server's protocol pings and answers them itself.
Modes and socket time:
  clock     one SNTP query, no socket
  bookall   65 s on the all-markets full-depth book stream, which spans one periodic snapshot
  bookone   65 s on the BTC-USD full-depth book stream
  bbo       15 s on the all-markets depth=1 stream and 15 s on BTC-USD depth=1
  prices    30 s on the all-markets mark and index streams at once
  funding   15 s on the all-markets funding stream
  rfq       15 s on the real (rfq) book of one RFQ market, 15 s on its indicative book and 8 s of the rfq path on BTC-USD
  errors    unknown, lowercase and wrong market paths, no User-Agent, a client text frame, a deflate offer, about 45 s
  silence   up to 30 s on BTC-USD depth=1 without answering the server's pings
Run from the repository root: uv run scripts/probes/venues/extended/ws-probe.py [mode ...]
Captures go to .claude/survey-work/extended/.
"""

import asyncio
import collections
import json
import socket
import statistics
import struct
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp

WORK = Path(".claude/survey-work/extended")
ROOT = "wss://api.starknet.extended.exchange/stream.extended.exchange/v1"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
RFQ_MARKET = "AIA-USD"  # an ACTIVE crypto RFQ market in the 2026-10-12 catalog


def now_ms() -> int:
    return int(time.time() * 1000)


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] + " UTC"


def pct(values: list[float], q: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(q * len(ordered)))] if ordered else float("nan")


def summary(values: list[float]) -> str:
    if not values:
        return "none"
    return f"n {len(values)} min {min(values):.0f} p10 {pct(values, 0.1):.0f} median {statistics.median(values):.0f} p90 {pct(values, 0.9):.0f} max {max(values):.0f}"


def save_lines(name: str, lines: list[str]) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text("\n".join(lines) + "\n")


async def collect(url: str, seconds: float, answer_pings: bool = True, headers: dict | None = None, compress: int = 0):
    """Returns (handshake info, frames as (arrival ms, kind, text), close info)."""
    frames = []
    info = {"url": url}
    hdrs = {"User-Agent": UA} if headers is None else headers
    skip = () if "User-Agent" in hdrs else ("User-Agent",)  # aiohttp adds its own User-Agent unless told not to
    async with aiohttp.ClientSession(skip_auto_headers=skip) as s:
        t0 = time.perf_counter()
        info["opened_at"] = now_ms()
        try:
            ws = await s.ws_connect(url, headers=hdrs, autoping=False, compress=compress, max_msg_size=0, timeout=aiohttp.ClientWSTimeout(ws_close=5))
        except aiohttp.WSServerHandshakeError as e:
            info["handshake_error"] = f"{e.status} {e.message} headers {dict(e.headers or {})}"
            return info, frames, None
        info["open_ms"] = round((time.perf_counter() - t0) * 1000)
        info["response_headers"] = dict(ws._response.headers)
        info["compress"] = ws.compress
        end = time.time() + seconds
        close = None
        while True:
            left = end - time.time()
            if left <= 0:
                break
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=left)
            except asyncio.TimeoutError:
                break
            t = now_ms()
            if msg.type == aiohttp.WSMsgType.TEXT:
                frames.append((t, "text", msg.data))
            elif msg.type == aiohttp.WSMsgType.BINARY:
                frames.append((t, "binary", msg.data))
            elif msg.type == aiohttp.WSMsgType.PING:
                frames.append((t, "ping", msg.data))
                if answer_pings:
                    await ws.pong(msg.data)
            elif msg.type == aiohttp.WSMsgType.PONG:
                frames.append((t, "pong", msg.data))
            elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSING, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                close = (t, str(msg.type), msg.data, msg.extra, ws.close_code)
                break
        if close is None:
            await ws.close()
        return info, frames, close


def ping_report(frames) -> str:
    pings = [f[0] for f in frames if f[1] == "ping"]
    gaps = [b - a for a, b in zip(pings, pings[1:])]
    return f"server pings {len(pings)}, gaps ms {gaps}, payloads {[f[2] for f in frames if f[1] == 'ping'][:3]}"


def analyse_books(frames, label: str, keep: int = 4) -> None:
    texts = [(t, json.loads(x)) for t, k, x in frames if k == "text"]
    sizes = [len(x) for t, k, x in frames if k == "text"]
    print(f"{label}: text frames {len(texts)}, binary {sum(1 for f in frames if f[1] == 'binary')}, bytes {sum(sizes)}, largest frame {max(sizes) if sizes else 0}")
    print(" ", ping_report(frames))
    kinds = collections.Counter((m.get("type"), m.get("data", {}).get("t")) for t, m in texts)
    print("  type and data.t", kinds)
    print("  top-level keys", collections.Counter(tuple(sorted(m.keys())) for t, m in texts).most_common(3))
    per = collections.defaultdict(list)
    for t, m in texts:
        per[m.get("data", {}).get("m")].append((t, m))
    print("  markets seen", len(per))
    global_seq = [m.get("seq") for t, m in texts]
    print("  seq of the first 12 frames on the connection", global_seq[:12])
    g = collections.Counter("next +1" if b == a + 1 else "repeat" if b == a else "jump" for a, b in zip(global_seq, global_seq[1:]))
    print("  connection-wide seq from frame to frame", dict(g), "first", global_seq[:1], "last", global_seq[-1:])
    for ty in ("SNAPSHOT", "DELTA"):
        a = [t - m["ts"] for t, m in texts if m.get("type") == ty and m.get("ts")]
        print(f"  {ty}: arrival minus ts ms", summary(a), "| ts 0 or absent", sum(1 for t, m in texts if m.get("type") == ty and not m.get("ts")))
    if WORK.exists():
        (WORK / f"ws-raw-{label.split(',')[0].replace(' ', '-').replace('/', '-')}.jsonl").write_text("\n".join(json.dumps([t, x]) for t, k, x in frames if k == "text") + "\n")
    gaps = repeats = ok = 0
    snap_seq = collections.Counter()
    snap_per_market = collections.Counter()
    snap_gaps = []
    dq = collections.Counter()
    level_counts = []
    rebuild_equal = rebuild_diff = 0
    order_issues = 0
    zero_c = 0
    ages = []
    deltas_per_s = []
    for market, items in per.items():
        last = None
        book = None
        snaps = []
        for t, m in items:
            seq = m.get("seq")
            d = m.get("data", {})
            ty = m.get("type") or d.get("t")
            ages.append(t - m.get("ts", t))
            if ty == "SNAPSHOT":
                snap_seq[seq] += 1
                snap_per_market[market] += 1
                snaps.append(t)
                bids = [(float(x["p"]), float(x.get("c", x["q"]))) for x in d.get("b", [])]
                asks = [(float(x["p"]), float(x.get("c", x["q"]))) for x in d.get("a", [])]
                level_counts.append((len(bids), len(asks)))
                if [p for p, _ in bids] != sorted([p for p, _ in bids], reverse=True) or [p for p, _ in asks] != sorted([p for p, _ in asks]):
                    order_issues += 1
                if book is not None:
                    fresh = ({p: q for p, q in bids}, {p: q for p, q in asks})
                    same = all(
                        {p: round(q, 9) for p, q in side.items() if q > 0} == {p: round(q, 9) for p, q in mine.items() if q > 0}
                        for side, mine in zip(fresh, book)
                    )
                    rebuild_equal += same
                    rebuild_diff += not same
                book = ({p: q for p, q in bids}, {p: q for p, q in asks})
                last = seq
                continue
            if last is not None:
                if seq == last + 1:
                    ok += 1
                elif seq == last:
                    repeats += 1
                else:
                    gaps += 1
            last = seq
            if book is None:
                continue
            for side_key, side in (("b", 0), ("a", 1)):
                for lvl in d.get(side_key, []):
                    p = float(lvl["p"])
                    prev = book[side].get(p, 0.0)
                    if "c" in lvl:
                        c = float(lvl["c"])
                        dq["c present"] += 1
                        if abs(float(lvl["q"]) - (c - prev)) < 1e-9 * max(1.0, abs(c)):
                            dq["q equals c minus previous"] += 1
                        elif abs(float(lvl["q"]) - c) < 1e-12:
                            dq["q equals c"] += 1
                        else:
                            dq["q is neither"] += 1
                        if c == 0:
                            zero_c += 1
                        book[side][p] = c
                    else:
                        dq["c absent"] += 1
                        book[side][p] = prev + float(lvl["q"])
        if len(snaps) > 1:
            snap_gaps += [b - a for a, b in zip(snaps, snaps[1:])]
        span = (items[-1][0] - items[0][0]) / 1000 if len(items) > 1 else 0
        if span:
            deltas_per_s.append(len(items) / span)
    print(f"  per-market seq: next +1 {ok}, repeated {repeats}, gaps {gaps}")
    print("  seq values carried by SNAPSHOT frames", dict(snap_seq.most_common(6)))
    print("  snapshots per market", collections.Counter(snap_per_market.values()))
    print("  gap between snapshots of one market ms", summary(snap_gaps))
    print("  delta levels", dict(dq), "levels with c 0 (removal)", zero_c)
    print("  rebuilt book against the next snapshot: equal", rebuild_equal, "different", rebuild_diff)
    bids = [a for a, b in level_counts]
    asks = [b for a, b in level_counts]
    print("  snapshot levels: bids", summary(bids), "| asks", summary(asks), "| order issues", order_issues)
    one_sided = sum(1 for a, b in level_counts if (a == 0) != (b == 0))
    empty = sum(1 for a, b in level_counts if a == 0 and b == 0)
    print("  one-sided snapshots", one_sided, "empty snapshots", empty)
    print("  arrival minus ts ms", summary(ages))
    print("  frames per second per market", summary(deltas_per_s))
    for name in ("BTC-USD", "ETH-USD", RFQ_MARKET):
        items = per.get(name)
        if items:
            ts = [t for t, m in items]
            inter = [b - a for a, b in zip(ts, ts[1:])]
            print(f"  {name}: frames {len(items)}, inter-arrival ms {summary(inter)}, first seq {[m.get('seq') for t, m in items[:5]]}")


async def mode_bookall() -> None:
    print(f"## bookall {stamp()}")
    info, frames, close = await collect(f"{ROOT}/orderbooks", 65)
    print("handshake", info.get("open_ms"), "ms", info.get("response_headers"), "close", close, info.get("handshake_error"))
    analyse_books(frames, "all markets, full depth")
    texts = [(t, x) for t, k, x in frames if k == "text"]
    lines = []
    shown = collections.Counter()
    for t, x in texts:
        m = json.loads(x)
        key = (m.get("type"), m.get("data", {}).get("m") in ("BTC-USD", RFQ_MARKET))
        if shown[key] < 3:
            shown[key] += 1
            trimmed = dict(m)
            d = dict(m.get("data", {}))
            d["b"] = d.get("b", [])[:3]
            d["a"] = d.get("a", [])[:3]
            trimmed["data"] = d
            lines.append(f"{t} {json.dumps(trimmed)}")
    save_lines("ws-bookall-frames.txt", lines)


async def mode_bookone() -> None:
    print(f"## bookone {stamp()}")
    info, frames, close = await collect(f"{ROOT}/orderbooks/BTC-USD", 65)
    print("handshake", info.get("open_ms"), "ms", info.get("response_headers"), "close", close)
    analyse_books(frames, "BTC-USD, full depth")
    texts = [(t, json.loads(x)) for t, k, x in frames if k == "text"]
    lines = []
    for t, m in texts[:6]:
        d = dict(m.get("data", {}))
        d["b"] = d.get("b", [])[:4]
        d["a"] = d.get("a", [])[:4]
        lines.append(f"{t} {json.dumps(dict(m, data=d))}")
    save_lines("ws-bookone-frames.txt", lines)


async def mode_bbo() -> None:
    print(f"## bbo {stamp()}")
    for url, secs in ((f"{ROOT}/orderbooks?depth=1", 15), (f"{ROOT}/orderbooks/BTC-USD?depth=1", 15)):
        info, frames, close = await collect(url, secs)
        print(url, "handshake", info.get("open_ms"), "ms close", close)
        analyse_books(frames, url.rsplit("/", 1)[-1])
        texts = [x for t, k, x in frames if k == "text"]
        save_lines(f"ws-bbo-{'all' if 'BTC' not in url else 'btc'}-frames.txt", texts[:5])


async def mode_prices() -> None:
    print(f"## prices {stamp()}")
    results = await asyncio.gather(collect(f"{ROOT}/prices/mark", 30), collect(f"{ROOT}/prices/index", 30))
    for (info, frames, close), label in zip(results, ("mark", "index")):
        texts = [(t, json.loads(x)) for t, k, x in frames if k == "text"]
        print(f"{label}: handshake {info.get('open_ms')} ms, frames {len(texts)}, close {close}")
        print(" ", ping_report(frames))
        print("  type", collections.Counter(m.get("type") for t, m in texts), "keys", collections.Counter(tuple(sorted(m.keys())) for t, m in texts).most_common(2))
        per = collections.defaultdict(list)
        for t, m in texts:
            per[m["data"]["m"]].append((t, m))
        print("  markets", len(per), "seq of first 8 frames", [m.get("seq") for t, m in texts[:8]])
        gs = [m.get("seq") for t, m in texts]
        print("  connection-wide seq from frame to frame", dict(collections.Counter("next +1" if y == x + 1 else "other" for x, y in zip(gs, gs[1:]))))
        print("  data keys", collections.Counter(tuple(sorted(m["data"].keys())) for t, m in texts).most_common(2), "sourceEventId values", collections.Counter(m.get("sourceEventId") for t, m in texts).most_common(3))
        inter = []
        seq_ok = seq_bad = 0
        calc_age, gen_age, gen_minus_calc = [], [], []
        zero_data_ts = 0
        for name, items in per.items():
            ts = [t for t, m in items]
            inter += [b - a for a, b in zip(ts, ts[1:])]
            seqs = [m.get("seq") for t, m in items]
            for a, b in zip(seqs, seqs[1:]):
                if b == a + 1:
                    seq_ok += 1
                else:
                    seq_bad += 1
            for t, m in items:
                dts = m["data"].get("ts") or 0
                if not dts:
                    zero_data_ts += 1
                else:
                    calc_age.append(t - dts)
                    gen_minus_calc.append(m["ts"] - dts)
                gen_age.append(t - m["ts"])
        print("  per-market seq +1", seq_ok, "other", seq_bad)
        print("  per-market inter-arrival ms", summary(inter))
        counts = [len(v) for v in per.values()]
        print("  frames per market over 30 s", summary(counts))
        print("  arrival minus data.ts ms", summary(calc_age), "| arrival minus ts ms", summary(gen_age), "| ts minus data.ts ms", summary(gen_minus_calc), "| data.ts 0 or absent", zero_data_ts)
        for name in ("BTC-USD", "ETH-USD", RFQ_MARKET, "XAU-USD", "MU_24_5-USD"):
            if name in per:
                vals = [(t, m["data"]["p"], m["data"].get("ts"), m.get("sourceEventId")) for t, m in per[name]]
                print(f"  {name}: {len(vals)} frames, distinct p {len({v[1] for v in vals})}, first {vals[:2]}")
        save_lines(f"ws-{label}-frames.txt", [x for t, k, x in frames if k == "text"][:6])
        missing = sorted(set(json.load(open(WORK / "anchor-last-poll.json"))) - set(per)) if (WORK / "anchor-last-poll.json").exists() else []
        print(f"  ACTIVE perps from the REST anchor run with no {label} frame in 30 s:", len(missing), missing[:40])


async def mode_funding() -> None:
    print(f"## funding {stamp()}")
    info, frames, close = await collect(f"{ROOT}/funding", 15)
    texts = [(t, json.loads(x)) for t, k, x in frames if k == "text"]
    print("handshake", info.get("open_ms"), "ms frames", len(texts), "close", close)
    print(" ", ping_report(frames))
    print("  first frames", [x for t, k, x in frames if k == "text"][:3])
    per = collections.Counter(m["data"]["m"] for t, m in texts if isinstance(m.get("data"), dict))
    print("  markets", len(per), "frames per market", collections.Counter(per.values()))
    save_lines("ws-funding-frames.txt", [x for t, k, x in frames if k == "text"][:6])


async def mode_rfq() -> None:
    print(f"## rfq {stamp()}")
    info, frames, close = await collect(f"{ROOT}/orderbooks/rfq/{RFQ_MARKET}", 15)
    print("rfq real book", RFQ_MARKET, "handshake", info.get("open_ms"), "close", close, info.get("handshake_error"))
    analyse_books(frames, f"rfq/{RFQ_MARKET}")
    save_lines("ws-rfq-frames.txt", [x for t, k, x in frames if k == "text"][:5])
    info, frames, close = await collect(f"{ROOT}/orderbooks/{RFQ_MARKET}", 15)
    analyse_books(frames, f"indicative {RFQ_MARKET}")
    info, frames, close = await collect(f"{ROOT}/orderbooks/rfq/BTC-USD", 8)
    print("rfq path on BTC-USD: text frames", sum(1 for f in frames if f[1] == "text"), "close", close, "ms after the open began", (close[0] - info["opened_at"]) if close else None, info.get("handshake_error"))


async def mode_errors() -> None:
    print(f"## errors {stamp()}")
    for path in ("orderbooks/NOPE-USD", "orderbooks/btc-usd", "orderbooks/BTC-USDT", "prices/mark/NOPE-USD", "nothing", "orderbooks/BTC-USD?depth=5"):
        info, frames, close = await collect(f"{ROOT}/{path}", 5)
        texts = [x for t, k, x in frames if k == "text"]
        after = (close[0] - info["opened_at"]) if close else None
        print(f"{path}: handshake {info.get('open_ms')} {info.get('handshake_error')} text frames {len(texts)} first {texts[:1]!r:.300} close {close} ms after the open began {after}")
    info, frames, close = await collect(f"{ROOT}/orderbooks/BTC-USD?depth=1", 5, headers={})
    print("no User-Agent header at all:", info.get("handshake_error") or f"opened, {len(frames)} frames")
    info, frames, close = await collect(f"{ROOT}/orderbooks/BTC-USD?depth=1", 5, compress=15)
    print("deflate offered: handshake", info.get("open_ms"), "Sec-WebSocket-Extensions", (info.get("response_headers") or {}).get("Sec-WebSocket-Extensions"), "negotiated window", info.get("compress"))
    async with aiohttp.ClientSession() as s:
        ws = await s.ws_connect(f"{ROOT}/orderbooks/BTC-USD?depth=1", headers={"User-Agent": UA}, autoping=False)
        await ws.send_str(json.dumps({"method": "subscribe", "market": "ETH-USD"}))
        t_ping = time.perf_counter()
        await ws.ping(b"probe")
        seen = collections.Counter()
        pong_ms = None
        other = []
        end = time.time() + 6
        while time.time() < end:
            try:
                msg = await asyncio.wait_for(ws.receive(), timeout=end - time.time())
            except asyncio.TimeoutError:
                break
            if msg.type == aiohttp.WSMsgType.PONG and pong_ms is None:
                pong_ms = round((time.perf_counter() - t_ping) * 1000)
            if msg.type == aiohttp.WSMsgType.TEXT:
                m = json.loads(msg.data)
                seen[m.get("data", {}).get("m")] += 1
                if "data" not in m or "m" not in m.get("data", {}):
                    other.append(msg.data[:200])
            if msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                other.append(f"close {msg.type} {msg.data} {msg.extra}")
                break
        print("client text frame and protocol ping: pong after ms", pong_ms, "markets in replies", dict(seen), "other frames", other[:3])
        await ws.close()


async def mode_silence() -> None:
    print(f"## silence {stamp()}")
    info, frames, close = await collect(f"{ROOT}/orderbooks/BTC-USD?depth=1", 30, answer_pings=False)
    pings = [f[0] for f in frames if f[1] == "ping"]
    texts = [f for f in frames if f[1] == "text"]
    first = frames[0][0] if frames else None
    print("pings not answered:", ping_report(frames))
    print("text frames", len(texts), "close", close, "close after ms from first frame", (close[0] - first) if close and first else None, "last ping to close ms", (close[0] - pings[-1]) if close and pings else None)


def mode_clock() -> None:
    print(f"## clock {stamp()}")
    for host in ("time.google.com", "pool.ntp.org"):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(3)
            pkt = b"\x1b" + 47 * b"\0"
            t1 = time.time()
            s.sendto(pkt, (host, 123))
            data, _ = s.recvfrom(48)
            t4 = time.time()
            secs, frac = struct.unpack("!II", data[40:48])
            server = secs - 2208988800 + frac / 2**32
            offset = server - (t1 + t4) / 2
            print(f"{host}: offset of the server clock against this host {offset * 1000:+.1f} ms, round trip {(t4 - t1) * 1000:.0f} ms")
        except OSError as e:
            print(host, "failed", e)


MODES = {"bookall": mode_bookall, "bookone": mode_bookone, "bbo": mode_bbo, "prices": mode_prices, "funding": mode_funding, "rfq": mode_rfq, "errors": mode_errors, "silence": mode_silence}

if __name__ == "__main__":
    picked = sys.argv[1:] or ["clock", *MODES]
    for m in picked:
        if m == "clock":
            mode_clock()
        else:
            asyncio.run(MODES[m]())
        print()
