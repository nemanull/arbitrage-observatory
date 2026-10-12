# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""BitTap all-market mark stream probe for docs/profiles/bittap/rest.md section 3.

The website's bundle names two all-market topics, f_markPrice_all and f_ticker_all, which the API docs do not list.
Public, unauthenticated and read-only, one socket for 12 s.
Run from the repository root with: uv run scripts/probes/venues/bittap/mark-all-probe.py
"""

import asyncio
import collections
import json
import statistics
import time
import urllib.request

import websockets

URL = "wss://stream.bittap.com/endpoint?format=JSON"
CATALOG = "https://api.bittap.com/asset/public/v1/exchange/info"
HOLD_S = 12


async def main() -> None:
    print("BitTap all-market stream probe, UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    req = urllib.request.Request(CATALOG, headers={"User-Agent": "arbitrage-observatory-probe/1.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        cs = json.load(r)["data"]["contractSymbols"]
    live = {s["symbolId"] for s in cs if s["status"] == "OPEN"}
    settled = {s["symbolId"] for s in cs if s["status"] != "OPEN"}

    ws = await websockets.connect(URL, compression=None, ping_interval=None, max_size=None, open_timeout=20)
    await asyncio.wait_for(ws.recv(), 10)
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": ["f_markPrice_all", "f_ticker_all"], "id": 1}))
    t0 = time.perf_counter()
    frames = collections.defaultdict(list)  # topic to [(arrival s, frame)]
    other = []
    samples = {}
    while time.perf_counter() - t0 < HOLD_S:
        try:
            raw = await asyncio.wait_for(ws.recv(), 1.0)
        except asyncio.TimeoutError:
            continue
        d = json.loads(raw)
        if isinstance(d, dict) and "e" in d:
            frames[d["e"]].append((time.perf_counter() - t0, d))
            samples.setdefault(d["e"], raw[:600])
        elif isinstance(d, list):
            key = f"array of {d[0].get('e') if d and isinstance(d[0], dict) else '?'}"
            frames[key].append((time.perf_counter() - t0, d))
            samples.setdefault(key, raw[:600])
        else:
            other.append(raw[:200])
    await ws.close()
    print("non-data frames:", other)
    for topic, fr in frames.items():
        print(f"\n{topic}: {len(fr)} frames in {HOLD_S} s, first at {fr[0][0] * 1000:.0f} ms")
        print("  sample:", samples[topic])
        payloads = [d for _, d in fr]
        rows = [x for p in payloads for x in (p if isinstance(p, list) else p.get("data", [p]) if isinstance(p.get("data", None), list) else [p])]
        syms = collections.Counter(x.get("s") for x in rows if isinstance(x, dict))
        print(f"  rows {len(rows)}, distinct symbols {len(syms)}, OPEN covered {len(live & set(syms))} of {len(live)}, SETTLED present {len(settled & set(syms))}")
        if fr and len(fr) > 1:
            gaps = [round((fr[i + 1][0] - fr[i][0]) * 1000) for i in range(len(fr) - 1)]
            print(f"  frame interval median {statistics.median(gaps)} ms, min {min(gaps)}, max {max(gaps)}")
        if syms:
            per = sorted(syms.values())
            print(f"  rows per symbol in {HOLD_S} s: min {per[0]} median {statistics.median(per)} max {per[-1]}")
        print(f"  bytes per frame median {statistics.median(len(json.dumps(d)) for d in payloads):.0f}")


if __name__ == "__main__":
    asyncio.run(main())
