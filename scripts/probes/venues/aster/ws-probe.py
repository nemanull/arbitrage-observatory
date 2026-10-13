# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13", "httpx>=0.27"]
# ///
"""Read-only probe of the Aster perpetual market socket, wss://fstream.asterdex.com.

Modes, all in turn by default (about four and a half minutes of socket time), or name some on the command line:
    basic    40 s on one combined socket: diff and partial book streams at every documented speed, bookTicker and markPrice@1s
             on BTCUSDT, plus the two book streams on ETHUSDT, a quiet market and a market whose id is not ASCII.
    zero     10 s on btcusdt@depth@0ms, a speed Binance offers and Aster does not document.
    batch    60 s on the 100 busiest kept markets, @depth@100ms and @depth20@100ms each, 200 streams in one subscribe frame.
    errors   unknown, uppercase and malformed subscriptions, 201 streams on one socket, and a burst of 12 frames in one second.
    markarr  15 s of !markPrice@arr@1s, the all market mark, index and funding stream.
    deflate  a handshake that offers permessage-deflate, and the raw /ws/ path.
    ping     three protocol pings and their pongs, and LIST_SUBSCRIPTIONS as an application keepalive.
    odd      8 s of depth20 on every kept id with a character outside A-Z and 0-9, such as 币安人生USDT and B-MONEYUSDT.
    quiet    30 s of depth20 on the 100 kept markets with the least volume, counting the ones that never send a frame.

Run from the repository root:
    uv run scripts/probes/venues/aster/ws-probe.py [mode ...]
Captures go to .claude/survey-work/aster/.
"""

import asyncio
import collections
import json
import statistics
import sys
import time
from pathlib import Path

import httpx
import websockets

WORK = Path(".claude/survey-work/aster")
BASE = "wss://fstream.asterdex.com"
REST = "https://fapi.asterdex.com"
FAMILY = ("USDT", "USDC", "USD")
PER_FRAME = 20  # streams per subscribe frame, see the errors mode


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def now_ms() -> int:
    return int(time.time() * 1000)


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


async def connect(path: str = "/stream", compression=None):
    t0 = time.perf_counter()
    ws = await websockets.connect(BASE + path, compression=compression, max_size=None, ping_interval=None, open_timeout=15)
    ms = (time.perf_counter() - t0) * 1000
    h = ws.response.headers
    out(event="open", path=path, ms=round(ms), status=ws.response.status_code,
        headers={k: h.get(k) for k in ("server", "via", "x-amz-cf-pop", "x-cache", "sec-websocket-extensions") if h.get(k)})
    return ws


def send(ws, method, params=None, id_=1):
    frame = {"method": method, "id": id_}
    if params is not None:
        frame["params"] = params
    return ws.send(json.dumps(frame, ensure_ascii=False))


class Stats:
    def __init__(self):
        self.frames = collections.Counter()
        self.bytes = collections.Counter()
        self.last_arrival = {}
        self.gaps_ms = collections.defaultdict(list)
        self.last_u = {}
        self.chain_ok = collections.Counter()
        self.chain_gap = collections.Counter()
        self.levels = collections.defaultdict(collections.Counter)
        self.order_bad = collections.Counter()
        self.ages = collections.defaultdict(list)
        self.first = {}
        self.keys = {}

    def take(self, stream: str, data, raw_len: int, arrival: int):
        self.frames[stream] += 1
        self.bytes[stream] += raw_len
        if stream in self.last_arrival:
            self.gaps_ms[stream].append(arrival - self.last_arrival[stream])
        self.last_arrival[stream] = arrival
        if stream not in self.first:
            self.first[stream] = data
            self.keys[stream] = sorted(data) if isinstance(data, dict) else type(data).__name__
        if not isinstance(data, dict):
            return
        if "E" in data:
            self.ages[stream].append(arrival - int(data["E"]))
        if data.get("e") == "depthUpdate":
            b, a = data.get("b", []), data.get("a", [])
            self.levels[stream][(len(b), len(a))] += 1
            if any(float(b[i][0]) <= float(b[i + 1][0]) for i in range(len(b) - 1)) or any(float(a[i][0]) >= float(a[i + 1][0]) for i in range(len(a) - 1)):
                self.order_bad[stream] += 1
            if stream in self.last_u:
                if data.get("pu") == self.last_u[stream]:
                    self.chain_ok[stream] += 1
                else:
                    self.chain_gap[stream] += 1
            self.last_u[stream] = data.get("u")

    def report(self, mode: str, streams, seconds: float):
        for s in streams:
            g = self.gaps_ms.get(s, [])
            lv = self.levels.get(s, {})
            out(mode=mode, stream=s, frames=self.frames[s], per_s=round(self.frames[s] / seconds, 2), bytes_per_frame=round(self.bytes[s] / max(1, self.frames[s])),
                gap_ms={"p10": pct(g, 0.1), "p50": pct(g, 0.5), "p90": pct(g, 0.9), "max": max(g) if g else None},
                chain_ok=self.chain_ok[s], chain_gap=self.chain_gap[s], order_bad=self.order_bad[s],
                level_counts=dict(collections.Counter({f"{k[0]}x{k[1]}": v for k, v in lv.items()}).most_common(4)) if lv else None,
                E_age_ms={"p50": pct(self.ages[s], 0.5), "p90": pct(self.ages[s], 0.9)} if self.ages.get(s) else None, keys=self.keys.get(s))


async def pump(ws, seconds, stats, log_other, capture=None):
    end = time.time() + seconds
    while True:
        left = end - time.time()
        if left <= 0:
            return None
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=left)
        except asyncio.TimeoutError:
            return None
        except websockets.ConnectionClosed as e:
            return e
        arrival = now_ms()
        msg = json.loads(raw)
        if isinstance(msg, dict) and "stream" in msg:
            stats.take(msg["stream"], msg["data"], len(raw), arrival)
            if capture is not None and msg["stream"] not in capture:
                capture[msg["stream"]] = raw[:1500]
        else:
            log_other(msg)


def kept_markets():
    with httpx.Client(timeout=20) as c:
        info = c.get(REST + "/fapi/v3/exchangeInfo").json()
        kept = {x["symbol"] for x in info["symbols"] if x["status"] == "TRADING" and x["quoteAsset"] in FAMILY and x["contractType"] == "PERPETUAL"}
        tick = c.get(REST + "/fapi/v3/ticker/24hr").json()
    vol = sorted(((float(t.get("quoteVolume") or 0), t["symbol"]) for t in tick if t["symbol"] in kept), reverse=True)
    return kept, [s for _, s in vol]


async def mode_basic():
    kept, by_vol = kept_markets()
    quiet = by_vol[-1]
    streams = ["btcusdt@depth@100ms", "btcusdt@depth", "btcusdt@depth@500ms", "btcusdt@depth20@100ms", "btcusdt@depth20", "btcusdt@depth10@500ms",
               "btcusdt@depth5@100ms", "btcusdt@bookTicker", "btcusdt@markPrice@1s", "ethusdt@depth@100ms", "ethusdt@depth20@100ms",
               f"{quiet.lower()}@depth@100ms", f"{quiet.lower()}@depth20@100ms", "币安人生usdt@depth@100ms", "币安人生usdt@depth20@100ms"]
    out(mode="basic", quiet_market=quiet, streams=streams)
    ws = await connect()
    stats, capture = Stats(), {}
    t_sub = now_ms()
    await send(ws, "SUBSCRIBE", streams, 1)
    others = []
    await pump(ws, 2, stats, lambda m: others.append((now_ms() - t_sub, m)), capture)
    await send(ws, "LIST_SUBSCRIPTIONS", None, 2)
    closed = await pump(ws, 38, stats, lambda m: others.append((now_ms() - t_sub, m)), capture)
    out(mode="basic", control_frames=others[:5], closed=str(closed) if closed else None)
    stats.report("basic", streams, 40)
    for s in ("btcusdt@depth@100ms", "btcusdt@depth20@100ms", "btcusdt@bookTicker", "btcusdt@markPrice@1s", "币安人生usdt@depth20@100ms"):
        out(mode="basic", capture_stream=s, frame=capture.get(s))
    for s in streams:
        if s in stats.first and isinstance(stats.first[s], dict):
            out(mode="basic", stream=s, first_arrival_after_subscribe_ms=None, first_U_u_pu=(stats.first[s].get("U"), stats.first[s].get("u"), stats.first[s].get("pu")))
    # Is a partial frame a whole top 20, and does its U/u/pu chain with the diff stream of the same market?
    d, p = stats.first.get("btcusdt@depth@100ms"), stats.first.get("btcusdt@depth20@100ms")
    out(mode="basic", diff_first=(d or {}).get("u"), partial_first=(p or {}).get("u"))
    await ws.close()


async def mode_zero():
    ws = await connect()
    stats, others = Stats(), []
    await send(ws, "SUBSCRIBE", ["btcusdt@depth@0ms"], 1)
    closed = await pump(ws, 10, stats, others.append)
    out(mode="zero", control_frames=others[:3], closed=str(closed) if closed else None)
    stats.report("zero", ["btcusdt@depth@0ms"], 10)
    await ws.close()


async def mode_batch():
    kept, by_vol = kept_markets()
    markets = by_vol[:100]
    streams = [f"{m.lower()}{suf}" for m in markets for suf in ("@depth@100ms", "@depth20@100ms")]
    ws = await connect()
    stats, others = Stats(), []
    t0 = now_ms()
    for i in range(0, len(streams), PER_FRAME):
        await send(ws, "SUBSCRIBE", streams[i:i + PER_FRAME], 1 + i // PER_FRAME)
        await asyncio.sleep(0.25)
    closed = await pump(ws, 60, stats, lambda m: others.append((now_ms() - t0, m)))
    out(mode="batch", markets=len(markets), streams=len(streams), control_frames=others[:3], closed=str(closed) if closed else None)
    total = sum(stats.frames.values())
    nbytes = sum(stats.bytes.values())
    diff = [s for s in streams if s.endswith("@depth@100ms")]
    part = [s for s in streams if s.endswith("@depth20@100ms")]
    out(mode="batch", frames=total, frames_per_s=round(total / 60, 1), kib_per_s=round(nbytes / 60 / 1024, 1),
        diff_frames=sum(stats.frames[s] for s in diff), diff_chain_ok=sum(stats.chain_ok[s] for s in diff), diff_chain_gap=sum(stats.chain_gap[s] for s in diff),
        partial_frames=sum(stats.frames[s] for s in part), partial_chain_ok=sum(stats.chain_ok[s] for s in part), partial_chain_gap=sum(stats.chain_gap[s] for s in part),
        order_bad=sum(stats.order_bad.values()), silent_streams=[s for s in streams if stats.frames[s] == 0])
    full = collections.Counter()
    for s in part:
        for (nb, na), n in stats.levels[s].items():
            full["20x20" if (nb, na) == (20, 20) else "short"] += n
    out(mode="batch", partial_level_shape=dict(full), short_markets=[s for s in part if any(k != (20, 20) for k in stats.levels[s])][:15])
    pg = [g for s in part for g in stats.gaps_ms[s]]
    dg = [g for s in diff for g in stats.gaps_ms[s]]
    out(mode="batch", partial_gap_ms={"p10": pct(pg, 0.1), "p50": pct(pg, 0.5), "p90": pct(pg, 0.9), "max": max(pg, default=None)},
        diff_gap_ms={"p10": pct(dg, 0.1), "p50": pct(dg, 0.5), "p90": pct(dg, 0.9), "max": max(dg, default=None)},
        partial_E_age_ms={"p50": pct([a for s in part for a in stats.ages[s]], 0.5), "p90": pct([a for s in part for a in stats.ages[s]], 0.9)})
    gap_streams = sorted(((stats.chain_gap[s], s) for s in diff if stats.chain_gap[s]), reverse=True)[:10]
    out(mode="batch", worst_diff_gap_streams=gap_streams)
    await ws.close()


async def mode_errors():
    ws = await connect()
    stats, others = Stats(), []
    await send(ws, "SUBSCRIBE", ["nopeusdt@depth20@100ms"], 11)
    await pump(ws, 2, stats, others.append)
    await send(ws, "SUBSCRIBE", ["BTCUSDT@depth20@100ms"], 12)
    await pump(ws, 2, stats, others.append)
    await send(ws, "SUBSCRIBE", ["tonusdt@depth20@100ms"], 13)  # settling on 2026-10-12
    await pump(ws, 2, stats, others.append)
    await ws.send("{not json")
    await pump(ws, 1, stats, others.append)
    await send(ws, "NOPE", [], 14)
    await pump(ws, 1, stats, others.append)
    await send(ws, "LIST_SUBSCRIPTIONS", None, 15)
    closed = await pump(ws, 2, stats, others.append)
    out(mode="errors", replies=others, frames_by_stream=dict(stats.frames), closed=str(closed) if closed else None)
    await ws.close()

    kept, by_vol = kept_markets()
    streams = [f"{m.lower()}@bookTicker" for m in by_vol[:201]]
    ws = await connect()
    others = []
    await send(ws, "SUBSCRIBE", streams, 21)
    closed = await pump(ws, 4, Stats(), others.append)
    out(mode="errors", case="201 streams in one frame", replies=others[:3], closed=str(closed) if closed else None)
    if not closed:
        await ws.close()

    for parts in ((100, 100), (150,), (199,), (200,)):  # where the 200 stream cap bites, frames of these sizes on one fresh socket
        ws = await connect()
        others, start, closed = [], 0, None
        for k, n in enumerate(parts):
            await send(ws, "SUBSCRIBE", [f"{m.lower()}@bookTicker" for m in by_vol[start:start + n]], 40 + k)
            start += n
            closed = await pump(ws, 1.5, Stats(), others.append)
            if closed:
                break
        out(mode="errors", case=f"frames of {parts} streams on one socket", replies=others[:3],
            closed=f"{closed.rcvd.code if closed.rcvd else None} {closed.rcvd.reason if closed.rcvd else ''}" if closed else None)
        if not closed:
            await ws.close()

    for n in (100, 50, 30, 20):  # streams in one subscribe frame, each on a fresh socket
        ws = await connect()
        others = []
        await send(ws, "SUBSCRIBE", [f"{m.lower()}@bookTicker" for m in by_vol[:n]], 30 + n)
        closed = await pump(ws, 3, Stats(), others.append)
        out(mode="errors", case=f"{n} streams in one frame", replies=others[:2],
            closed=f"{closed.rcvd.code if closed.rcvd else None} {closed.rcvd.reason if closed.rcvd else ''}" if closed else None)
        if not closed:
            await ws.close()

    ws = await connect()
    others = []
    t0 = time.perf_counter()
    for i in range(12):
        await send(ws, "LIST_SUBSCRIPTIONS", None, 100 + i)
    sent_ms = (time.perf_counter() - t0) * 1000
    closed = await pump(ws, 4, Stats(), others.append)
    out(mode="errors", case="12 frames in one burst", sent_in_ms=round(sent_ms, 1), replies=len(others), first=others[:2],
        closed=f"{closed.rcvd.code if closed and closed.rcvd else None} {closed.rcvd.reason if closed and closed.rcvd else ''}" if closed else None)
    if not closed:
        await ws.close()


async def mode_markarr():
    kept, _ = kept_markets()
    ws = await connect()
    seen, rows, gaps, last, ages = set(), [], [], None, []
    others = []
    await send(ws, "SUBSCRIBE", ["!markPrice@arr@1s"], 1)
    end = time.time() + 15
    sample = None
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        arrival = now_ms()
        msg = json.loads(raw)
        if isinstance(msg, dict) and msg.get("stream"):
            data = msg["data"]
            rows.append(len(data))
            seen |= {x["s"] for x in data}
            if last:
                gaps.append(arrival - last)
            last = arrival
            ages.append(arrival - max(int(x["E"]) for x in data))
            sample = sample or next((x for x in data if x["s"] == "BTCUSDT"), None)
        else:
            others.append(msg)
    out(mode="markarr", frames=len(rows), rows_per_frame=(min(rows), max(rows)) if rows else None, gap_ms={"p50": pct(gaps, 0.5), "max": max(gaps) if gaps else None},
        newest_E_age_ms={"p50": pct(ages, 0.5), "max": max(ages) if ages else None}, kept_covered=len(kept & seen), kept=len(kept), symbols_not_kept=len(seen - kept), ack=others[:2], btc=sample)
    await ws.close()


async def mode_deflate():
    ws = await connect("/stream", compression="deflate")
    out(mode="deflate", negotiated=ws.response.headers.get("sec-websocket-extensions"))
    await ws.close()
    ws = await connect("/ws/btcusdt@depth20@100ms")
    raw = await asyncio.wait_for(ws.recv(), timeout=10)
    out(mode="deflate", raw_path_first_frame=raw[:400])
    await ws.close()


async def mode_ping():
    ws = await connect()
    rtts = []
    for _ in range(3):
        t0 = time.perf_counter()
        waiter = await ws.ping()
        await asyncio.wait_for(waiter, timeout=5)
        rtts.append(round((time.perf_counter() - t0) * 1000, 1))
        await asyncio.sleep(1)
    others = []
    t0 = time.perf_counter()
    await send(ws, "LIST_SUBSCRIPTIONS", None, 9)
    await pump(ws, 2, Stats(), others.append)
    out(mode="ping", protocol_pong_rtt_ms=rtts, list_subscriptions_reply=others[:1], reply_ms=round((time.perf_counter() - t0) * 1000))
    await ws.close()


async def mode_odd():
    kept, _ = kept_markets()
    odd = sorted(m for m in kept if not all(c.isascii() and (c.isupper() or c.isdigit()) for c in m))
    streams = [f"{m.lower()}@depth20@100ms" for m in odd]
    ws = await connect()
    stats, others = Stats(), []
    await send(ws, "SUBSCRIBE", streams, 1)
    closed = await pump(ws, 8, stats, others.append)
    out(mode="odd", ids=odd, ack=others[:1], closed=str(closed) if closed else None,
        frames={s: stats.frames[s] for s in streams}, symbols_on_frames=sorted({d.get("s") for d in stats.first.values() if isinstance(d, dict)}))
    await ws.close()


async def mode_quiet():
    kept, by_vol = kept_markets()
    markets = by_vol[-100:]  # the 100 kept markets with the least 24 h quote volume
    streams = [f"{m.lower()}@depth20@100ms" for m in markets]
    ws = await connect()
    stats, others = Stats(), []
    first = {}
    t0 = now_ms()
    for i in range(0, len(streams), PER_FRAME):
        await send(ws, "SUBSCRIBE", streams[i:i + PER_FRAME], 1 + i // PER_FRAME)
        await asyncio.sleep(0.25)
    end = time.time() + 30
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(), timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            break
        arrival = now_ms()
        msg = json.loads(raw)
        if isinstance(msg, dict) and "stream" in msg:
            first.setdefault(msg["stream"], arrival - t0)
            stats.take(msg["stream"], msg["data"], len(raw), arrival)
        else:
            others.append(msg)
    silent = [s for s in streams if stats.frames[s] == 0]
    firsts = sorted(first.values())
    out(mode="quiet", markets=len(markets), frames=sum(stats.frames.values()), silent_streams=len(silent), silent_sample=silent[:12],
        first_frame_ms_after_first_subscribe={"p50": pct(firsts, 0.5), "p90": pct(firsts, 0.9), "max": max(firsts, default=None)},
        streams_with_one_frame=sum(1 for s in streams if stats.frames[s] == 1), short_frames=sum(n for s in streams for k, n in stats.levels[s].items() if k != (20, 20)),
        one_sided=sum(n for s in streams for k, n in stats.levels[s].items() if 0 in k), acks=len(others))
    await ws.close()


MODES = {"basic": mode_basic, "zero": mode_zero, "batch": mode_batch, "errors": mode_errors, "markarr": mode_markarr, "deflate": mode_deflate, "ping": mode_ping, "odd": mode_odd, "quiet": mode_quiet}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    for m in sys.argv[1:] or list(MODES):
        out(mode=m, started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        asyncio.run(MODES[m]())
