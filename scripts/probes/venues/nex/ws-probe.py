# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""NEX Exchange WebSocket probe for docs/profiles/nex/websocket.md.

Public, unauthenticated and read-only.
NEX publishes no WebSocket documentation.
The two socket URLs and every frame shape come from the n-exchange.io web bundle:
  futures wss://api.allinpro.com/futures/wsf and spot wss://ws.allinpro.com/ws, JSON-RPC style {method, params, id}.
Five sessions run at the same time, about 140 socket seconds in total:
  A. 40 s on the futures socket: ping, subscribe.state, subscribe.depth on BTCUSDT and ETHUSDT, subscribe.trade, then client silence.
  B. 30 s on the spot socket: ping, subscribe.depth on BTC-USDT and ETH-USDT, subscribe.trade, subscribe.all_quote, a second ping at 15 s.
  C. 60 s on the spot socket with one depth subscription and no ping, to see whether the server drops a silent client.
  D. 5 s each on the futures and spot sockets after a depth subscription to an unknown market, then a ping.
An earlier run found that an unknown market drops the whole connection, so D runs on its own sockets.
Run from the repository root with: uv run scripts/probes/venues/nex/ws-probe.py
Captures land in .claude/survey-work/nex/.
"""

import asyncio
import collections
import json
import pathlib
import statistics
import time
import urllib.request

import websockets

FUT = "wss://api.allinpro.com/futures/wsf"
SPOT = "wss://ws.allinpro.com/ws"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "nex"
WORK.mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
OUT = {}


def connect(url):
    return websockets.connect(url, compression="deflate", open_timeout=10, ping_interval=None, max_size=None,
                              user_agent_header=UA, additional_headers={"Origin": "https://n-exchange.io"})


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


def parse(frames):
    out = []
    for t, m in frames:
        if isinstance(m, bytes):
            out.append((t, {"_binary": len(m)}))
            continue
        try:
            out.append((t, json.loads(m)))
        except ValueError:
            out.append((t, {"_text": m[:200]}))
    return out


def key_of(msg):
    if "method" in msg:
        r = msg.get("result")
        if isinstance(r, dict):
            sym = r.get("market")
            if not sym and isinstance(r.get("data"), dict):
                sym = r["data"].get("symbol")
            return f"{msg['method']} {sym or ''}".strip()
        return msg["method"]
    if "error" in msg or "result" in msg:
        return f"reply id={msg.get('id')}"
    return "other"


def summarize(name, frames, sent, close, handshake):
    msgs = parse(frames)
    by = collections.defaultdict(list)
    for t, m in msgs:
        by[key_of(m)].append((t, m))
    s = {"handshake": handshake, "sent": sent, "close": close, "frames": len(msgs),
         "binary_frames": sum(1 for _, m in msgs if "_binary" in m), "by_key": {}}
    for k, v in by.items():
        ts = [t for t, _ in v]
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        s["by_key"][k] = {"count": len(v), "median_gap_s": round(statistics.median(gaps), 3) if gaps else None,
                          "first": json.dumps(v[0][1])[:900], "last": json.dumps(v[-1][1])[:400]}
    (WORK / f"ws-{name}-frames.json").write_text(json.dumps([[t, m] for t, m in msgs], indent=0)[:3_000_000])
    return s, msgs


async def session(url, subs, secs, ping_mid=None):
    sent = []
    frames = []
    t0 = time.time()
    try:
        async with connect(url) as ws:
            hs = {"open_s": round(time.time() - t0, 3), "extensions": ws.response.headers.get("Sec-WebSocket-Extensions"),
                  "server": ws.response.headers.get("Server")}
            for f in subs:
                await ws.send(json.dumps(f))
                sent.append(f)
                await asyncio.sleep(0.3)
            close = await collect(ws, secs if ping_mid is None else secs / 2, frames)
            if close is None and ping_mid is not None:
                await ws.send(json.dumps(ping_mid))
                sent.append(ping_mid)
                close = await collect(ws, secs / 2, frames)
    except websockets.ConnectionClosed as e:
        close = f"closed while sending {e.rcvd.code if e.rcvd else None}"
        hs = locals().get("hs")
    return {"t0": t0, "held_s": round(time.time() - t0, 1), "handshake": hs, "sent": sent, "close": close, "frames": frames}


FUT_SUBS = [
    {"method": "ping", "params": {}, "id": 0},
    {"method": "subscribe.state", "params": {}, "id": 0},
    {"method": "subscribe.depth", "params": {"market": "BTCUSDT", "merge": "0"}, "id": 0},
    {"method": "subscribe.depth", "params": {"market": "ETHUSDT", "merge": "0.01"}, "id": 0},
    {"method": "subscribe.trade", "params": {"market": "BTCUSDT"}, "id": 0},
]
SPOT_SUBS = [
    {"method": "ping"},
    {"method": "subscribe.depth", "params": {"market": "BTC-USDT", "merge": "step0"}, "id": 1},
    {"method": "subscribe.depth", "params": {"market": "ETH-USDT", "merge": "step0"}, "id": 1},
    {"method": "subscribe.trade", "params": {"market": "BTC-USDT"}, "id": 1},
    {"method": "subscribe.all_quote", "params": {}, "id": 1},
]


def depth_analysis(msgs, method="update.depth"):
    """Per market: level counts, whether every push repeats the full book, and any sequence-like field."""
    out = {}
    per = collections.defaultdict(list)
    for t, m in msgs:
        if m.get("method") != method:
            continue
        r = m.get("result") or {}
        d = r.get("data") if isinstance(r.get("data"), dict) else r
        sym = d.get("symbol") or r.get("market")
        per[sym].append((t, r, d))
    for sym, v in per.items():
        sizes = [(len(d.get("bids") or []), len(d.get("asks") or [])) for _, _, d in v]
        keys = sorted(set(k for _, r, d in v for k in list(r.keys()) + list(d.keys())))
        changed = sum(1 for (_, _, a), (_, _, b) in zip(v, v[1:]) if a.get("bids") != b.get("bids") or a.get("asks") != b.get("asks"))
        ts = [t for t, _, _ in v]
        gaps = [b - a for a, b in zip(ts, ts[1:])]
        bid0 = v[-1][2].get("bids", [None])[0] if v[-1][2].get("bids") else None
        ask0 = v[-1][2].get("asks", [None])[0] if v[-1][2].get("asks") else None
        out[sym] = {"pushes": len(v), "level_counts_min_max": [min(sizes), max(sizes)], "keys": keys,
                    "pushes_that_differ_from_previous": changed,
                    "median_gap_s": round(statistics.median(gaps), 3) if gaps else None,
                    "last_best_bid": bid0, "last_best_ask": ask0}
    return out


def tpp_analysis(msgs):
    """The undocumented tpp field: per topic, is it constant, increasing, or something else."""
    per = collections.defaultdict(list)
    for _, m in msgs:
        r = m.get("result")
        d = r.get("data") if isinstance(r, dict) and isinstance(r.get("data"), dict) else None
        if d and "tpp" in d:
            per[d.get("topic")].append(d["tpp"])
    return {k: {"n": len(v), "distinct": sorted(set(v))[:10], "first": v[0], "last": v[-1]} for k, v in per.items()}


async def main():
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rest_before = rest_json("https://api.allinpro.com/api/spot/tickers/depth?symbol=BTC-USDT&merge=step0")["data"]
    runs = await asyncio.gather(
        session(FUT, FUT_SUBS, 40),
        session(SPOT, SPOT_SUBS, 30, ping_mid={"method": "ping"}),
        session(SPOT, [{"method": "subscribe.depth", "params": {"market": "BTC-USDT", "merge": "step0"}, "id": 1}], 60),
        session(FUT, [{"method": "subscribe.depth", "params": {"market": "FOOUSDT", "merge": "0"}, "id": 0}, {"method": "ping"}], 5),
        session(SPOT, [{"method": "subscribe.depth", "params": {"market": "FOO-USDT", "merge": "step0"}, "id": 1}, {"method": "ping"}], 5),
        return_exceptions=True)
    names = ["futures", "spot", "spot_silent_60s", "futures_unknown_market", "spot_unknown_market"]
    OUT["started_utc"] = started
    OUT["rest_btc_book_before"] = {"bids": len(rest_before["bids"]), "asks": len(rest_before["asks"]),
                                   "best_bid": rest_before["bids"][:1], "best_ask": rest_before["asks"][:1]}
    total = 0
    for name, res in zip(names, runs):
        if isinstance(res, Exception):
            OUT[name] = {"error": repr(res)}
            continue
        total += res["held_s"]
        s, msgs = summarize(name, res["frames"], res["sent"], res["close"], res["handshake"])
        s["held_s"] = res["held_s"]
        s["depth"] = depth_analysis(msgs)
        s["tpp"] = tpp_analysis(msgs)
        s["frame_times_s"] = [round(t - res["t0"], 2) for t, _ in msgs][:12]
        OUT[name] = s
    OUT["socket_seconds_total"] = round(total, 1)
    (WORK / "ws-probe.json").write_text(json.dumps(OUT, indent=2))
    print(json.dumps(OUT, indent=2))


asyncio.run(main())
