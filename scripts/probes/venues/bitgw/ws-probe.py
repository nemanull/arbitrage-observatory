# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13"]
# ///
"""BitGW public WebSocket probe for docs/profiles/bitgw/websocket.md.

Public, unauthenticated and read-only, about two minutes of socket time on two BitGW sockets and one OKX socket, run at once.
BitGW publishes no WebSocket documentation, so the frames are the ones its own web app sends.
Modes, run concurrently:
  main     joins the "index" group and three market groups, sends the app's "heartbeat" text every 30 s, then tries an unknown key, a bad frame and a leave.
  okx      OKX's public books5 and trades for the same three pairs, to compare sequence ids, trade ids and arrival times.
  silence  joins every catalog pair's group, never sends a heartbeat, and records whether and when the server closes.
Run from the repository root with: uv run scripts/probes/venues/bitgw/ws-probe.py
Captures land in .claude/survey-work/bitgw/.
"""

import asyncio
import collections
import json
import pathlib
import statistics
import time
import urllib.request

import websockets

ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "bitgw"
WORK.mkdir(parents=True, exist_ok=True)
BITGW = "wss://bitgw.com:8443"
OKX_WS = "wss://ws.okx.com:8443/ws/v5/public"
PAIRS = ["BTC-USDT", "ETH-USDT", "SOL-USDT"]
MAIN_SECONDS = 75
SILENCE_SECONDS = 100


def now_ms():
    return time.time() * 1000


async def main_mode(log):
    t0 = time.monotonic()
    frames = []
    async with websockets.connect(BITGW, open_timeout=15, ping_interval=None, max_size=None) as ws:
        log["main_open_ms"] = round((time.monotonic() - t0) * 1000)
        log["main_handshake_status"] = ws.response.status_code
        log["main_handshake_headers"] = {k: v for k, v in ws.response.headers.raw_items() if k.lower() in ("server", "sec-websocket-extensions", "cf-ray")}

        async def read_until(deadline, tag):
            while True:
                left = deadline - time.monotonic()
                if left <= 0:
                    return
                try:
                    m = await asyncio.wait_for(ws.recv(), left)
                except asyncio.TimeoutError:
                    return
                frames.append((tag, now_ms(), m))

        await read_until(time.monotonic() + 3, "before-join")
        await ws.send(json.dumps({"type": "joinGroup", "key": "index"}))
        log["join_sent_ms"] = now_ms()
        for p in PAIRS:
            await ws.send(json.dumps({"type": "joinGroup", "key": p}))
        start = time.monotonic()
        next_hb = start + 30
        while time.monotonic() < start + MAIN_SECONDS - 15:
            await read_until(min(next_hb, start + MAIN_SECONDS - 15), "joined")
            if time.monotonic() >= next_hb:
                log.setdefault("heartbeat_sent_ms", []).append(now_ms())
                await ws.send("heartbeat")
                next_hb += 30
        await ws.send(json.dumps({"type": "joinGroup", "key": "FOO-USDT"}))
        await read_until(time.monotonic() + 4, "unknown-key")
        await ws.send("{not json")
        await read_until(time.monotonic() + 3, "bad-frame")
        await ws.send(json.dumps({"type": "leaveGroup", "key": "SOL-USDT"}))
        log["leave_sent_ms"] = now_ms()
        await read_until(time.monotonic() + 8, "after-leave")
    log["main_frames"] = len(frames)
    return frames


async def okx_mode(log):
    frames = []
    async with websockets.connect(OKX_WS, open_timeout=15, ping_interval=None, max_size=None) as ws:
        args = [{"channel": "books5", "instId": p} for p in PAIRS] + [{"channel": "trades", "instId": p} for p in PAIRS]
        await ws.send(json.dumps({"op": "subscribe", "args": args}))
        end = time.monotonic() + MAIN_SECONDS + 3
        last_ping = time.monotonic()
        while time.monotonic() < end:
            if time.monotonic() - last_ping > 20:
                await ws.send("ping")
                last_ping = time.monotonic()
            try:
                m = await asyncio.wait_for(ws.recv(), 1)
            except asyncio.TimeoutError:
                continue
            frames.append((now_ms(), m))
    log["okx_frames"] = len(frames)
    return frames


async def silence_mode(log, keys):
    t0 = time.monotonic()
    counts = collections.Counter()
    try:
        async with websockets.connect(BITGW, open_timeout=15, ping_interval=None, max_size=None) as ws:
            for k in keys:
                await ws.send(json.dumps({"type": "joinGroup", "key": k}))
            while time.monotonic() - t0 < SILENCE_SECONDS:
                try:
                    m = await asyncio.wait_for(ws.recv(), 1)
                except asyncio.TimeoutError:
                    continue
                d = json.loads(m)
                if d.get("type") == "k":
                    counts[(d["data"]["arg"]["instId"], d["data"]["arg"]["channel"])] += 1
                else:
                    counts[("other", d.get("type"))] += 1
            log["silence_result"] = f"still open after {SILENCE_SECONDS} s with no client frame after the joins"
    except websockets.ConnectionClosed as e:
        log["silence_result"] = f"closed after {time.monotonic() - t0:.1f} s, code={e.code} reason={e.reason!r}"
    books_keys = {k for (k, ch) in counts if ch == "books5"}
    log["silence_groups_joined"] = len(keys)
    log["silence_groups_with_books5"] = len(books_keys)
    log["silence_missing_books5"] = sorted(set(keys) - books_keys)
    log["silence_frames"] = sum(counts.values())
    log["silence_books5_per_s"] = round(sum(n for (k, ch), n in counts.items() if ch == "books5") / SILENCE_SECONDS, 1)


def catalog_keys():
    # The silence socket joins every market's group, so it reads the anonymous catalog the web app loads first.
    import hashlib
    import urllib.parse
    p = {"type": "marketInit", "language": 0, "platform": "H5", "system_language": "en", "version": "2.1.2",
         "timestamp": int(time.time() * 1000), "url": "home"}
    norm = lambda v: str(v).replace(" ", "").replace("\r", "").replace("\n", "").lower()  # noqa: E731
    base = "&".join(f"{norm(k)}={norm(p[k])}" for k in sorted(p)) + "&key=BCAB2AE64900D83EAC3114768232F868"
    p["sign"] = hashlib.md5(norm(base).encode()).hexdigest()
    req = urllib.request.Request("https://bitgw.com/api/home", data=urllib.parse.urlencode(p).encode(), headers={
        "content-type": "application/x-www-form-urlencoded;charset=utf-8", "User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return [m["key"] for m in json.loads(r.read())["data"]]


def analyse(log, frames, okx_frames):
    by_kind = collections.Counter()
    books = collections.defaultdict(list)
    trades = collections.defaultdict(list)
    tickers = []
    samples = {}
    for tag, t, m in frames:
        try:
            d = json.loads(m)
        except ValueError:
            by_kind[(tag, "non-json")] += 1
            samples.setdefault(f"{tag}:non-json", m[:300])
            continue
        typ = d.get("type")
        if typ == "k":
            ch, inst = d["data"]["arg"]["channel"], d["data"]["arg"]["instId"]
            by_kind[(tag, f"k/{ch}")] += 1
            samples.setdefault(f"k/{ch}", m[:900])
            if ch == "books5":
                for b in d["data"]["data"]:
                    books[inst].append((t, b, tag))
            if ch == "trades":
                for tr in d["data"]["data"]:
                    trades[inst].append((t, tr))
        else:
            by_kind[(tag, typ)] += 1
            samples.setdefault(f"{tag}:{typ}", m[:900])
            if typ == "tickers":
                tickers.append((t, d))
    log["frame_kinds"] = {f"{a} {b}": n for (a, b), n in sorted(by_kind.items())}
    okx_books, okx_trades = collections.defaultdict(dict), collections.defaultdict(dict)
    for t, m in okx_frames:
        if m == "pong":
            continue
        d = json.loads(m)
        if "data" not in d:
            continue
        ch, inst = d["arg"]["channel"], d["arg"]["instId"]
        for x in d["data"]:
            if ch == "books5":
                okx_books[inst][x["seqId"]] = (t, x)
            else:
                okx_trades[inst][x["tradeId"]] = (t, x)
    out = {}
    for p in PAIRS:
        rows = [(t, b) for t, b, tag in books[p] if tag == "joined"]
        if len(rows) < 2:
            continue
        gaps = [rows[i + 1][0] - rows[i][0] for i in range(len(rows) - 1)]
        seqs = [b.get("seqId") for _, b in rows]
        rising = sum(1 for i in range(len(seqs) - 1) if seqs[i + 1] is not None and seqs[i] is not None and seqs[i + 1] > seqs[i])
        repeats = sum(1 for i in range(len(rows) - 1) if rows[i + 1][1]["asks"] == rows[i][1]["asks"] and rows[i + 1][1]["bids"] == rows[i][1]["bids"])
        in_okx = [s for s in seqs if s in okx_books[p]]
        same_levels = sum(1 for _, b in rows if b.get("seqId") in okx_books[p] and okx_books[p][b["seqId"]][1]["asks"] == b["asks"] and okx_books[p][b["seqId"]][1]["bids"] == b["bids"])
        lag = [t - okx_books[p][b["seqId"]][0] for t, b in rows if b.get("seqId") in okx_books[p]]
        age = [t - int(b["ts"]) for t, b in rows]
        okx_n = len(okx_books[p])
        tr_ids = [tr["tradeId"] for _, tr in trades[p]]
        out[p] = {
            "books5_frames": len(rows), "okx_books5_frames": okx_n,
            "interval_ms_median": round(statistics.median(gaps)), "interval_ms_p10": round(sorted(gaps)[len(gaps) // 10]),
            "interval_ms_max": round(max(gaps)),
            "levels_per_side": sorted({(len(b["asks"]), len(b["bids"])) for _, b in rows}),
            "level_shape": len(rows[0][1]["asks"][0]), "fields": sorted(rows[0][1].keys()),
            "seqId_rising_pairs": rising, "seqId_pairs": len(seqs) - 1, "identical_consecutive": repeats,
            "seqIds_also_on_okx": len(in_okx), "identical_levels_to_okx_same_seqId": same_levels,
            "receive_lag_vs_okx_ms_median": round(statistics.median(lag)) if lag else None,
            "receive_lag_vs_okx_ms_p90": round(sorted(lag)[int(len(lag) * 0.9)]) if lag else None,
            "age_vs_ts_ms_median": round(statistics.median(age)),
            "share_of_okx_updates_relayed": round(len(in_okx) / okx_n, 2) if okx_n else None,
            "first_books5_ms_after_join": round(rows[0][0] - log["join_sent_ms"]),
            "trades": len(tr_ids), "trade_ids_also_on_okx": sum(1 for i in tr_ids if i in okx_trades[p]),
        }
    log["per_pair"] = out
    hb = [t for tag, t, m in frames if '"heart"' in m]
    log["heart_frames"] = len(hb)
    log["heart_reply_ms_after_send"] = [round(min((h - s for h in hb if h >= s), default=-1)) for s in log.get("heartbeat_sent_ms", [])]
    leave = log.get("leave_sent_ms", 0)
    sol_after = [t for t, b, tag in books["SOL-USDT"] if tag == "after-leave" and t > leave + 1500]
    log["sol_books5_after_leave_plus_1500ms"] = len(sol_after)
    log["unknown_key_frames"] = sum(n for (tag, k), n in by_kind.items() if tag == "unknown-key" and "FOO" in k)
    log["unknown_key_any_foo_text"] = any("FOO" in m for tag, t, m in frames if tag in ("unknown-key", "bad-frame", "after-leave"))
    log["before_join_frames"] = sum(n for (tag, _), n in by_kind.items() if tag == "before-join")
    if tickers:
        keys = collections.Counter(d["data"].get("instId") for _, d in tickers)
        log["tickers_frames"] = len(tickers)
        log["tickers_instruments"] = len(keys)
        log["tickers_fields"] = sorted(tickers[0][1]["data"].keys())
    (WORK / "ws-samples.json").write_text(json.dumps(samples, indent=1))
    return samples


async def run():
    log = {"started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    keys = catalog_keys()
    frames, okx_frames, _ = await asyncio.gather(main_mode(log), okx_mode(log), silence_mode(log, keys))
    samples = analyse(log, frames, okx_frames)
    (WORK / "ws-log.json").write_text(json.dumps(log, indent=1))
    print(json.dumps(log, indent=1))
    print("== samples")
    for k, v in samples.items():
        print(k, "::", v[:500])


if __name__ == "__main__":
    asyncio.run(run())
