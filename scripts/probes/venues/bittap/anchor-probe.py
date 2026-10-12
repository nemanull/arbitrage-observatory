# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=13,<16"]
# ///
"""BitTap anchor probe for docs/profiles/bittap/rest.md section 3 and 4.

BitTap documents no REST call for index, mark or funding, so the anchor is read from the f_markPrice socket stream.
Public, unauthenticated and read-only.
It holds one socket for 40 s with every OPEN contract's f_markPrice, tries three all-market stream names,
and makes one public call to Binance USD-M premiumIndex to compare funding and index.
Run from the repository root with: uv run scripts/probes/venues/bittap/anchor-probe.py
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
BINANCE = "https://fapi.binance.com/fapi/v1/premiumIndex"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
HOLD_S = 40


def fetch(url: str):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
        return json.load(r)


async def main() -> None:
    print("BitTap anchor probe, UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    cs = fetch(CATALOG)["data"]["contractSymbols"]
    live = {s["symbolId"]: s for s in cs if s["status"] == "OPEN"}
    print(f"catalog: {len(live)} OPEN contracts")

    ws = await websockets.connect(URL, compression=None, ping_interval=None, max_size=None, open_timeout=20)
    await asyncio.wait_for(ws.recv(), 10)
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": ["f_markPrice@all", "!markPrice@arr", "f_markPrice"], "id": 1}))
    await ws.send(json.dumps({"method": "SUBSCRIBE", "params": [f"f_markPrice@{sid}" for sid in live], "id": 2}))
    t0 = time.perf_counter()
    rows = collections.defaultdict(list)  # symbol to [(arrival, frame)]
    acks = []
    sample = None
    next_ping = t0 + 20
    while time.perf_counter() - t0 < HOLD_S:
        if time.perf_counter() >= next_ping:
            next_ping += 20
            await ws.send(json.dumps({"id": "ka", "method": "PING"}))
        try:
            raw = await asyncio.wait_for(ws.recv(), 1.0)
        except asyncio.TimeoutError:
            continue
        d = json.loads(raw)
        if d.get("e") == "f_markPrice":
            rows[d["s"]].append((time.time() * 1000, d))
            if sample is None:
                sample = raw
        else:
            acks.append(raw[:200])
    await ws.close()
    print("non-data frames:", acks)
    print("sample frame:", sample)

    delivered = [s for s in live if rows[s]]
    print(f"contracts with at least one f_markPrice frame in {HOLD_S} s: {len(delivered)} of {len(live)}, silent {[s for s in live if not rows[s]]}")
    print("symbols outside the subscription:", sorted(set(rows) - set(live)))
    gaps, lags, changes = [], [], collections.Counter()
    for sid in delivered:
        fr = rows[sid]
        gaps += [fr[i + 1][1]["E"] - fr[i][1]["E"] for i in range(len(fr) - 1)]
        lags += [arr - d["E"] for arr, d in fr]
        for key in ("p", "I", "r", "T"):
            changes[key] += sum(1 for i in range(len(fr) - 1) if fr[i + 1][1][key] != fr[i][1][key])
        changes["pairs"] += len(fr) - 1
    print(f"event time step between frames of one contract: median {statistics.median(gaps)} ms, min {min(gaps)}, max {max(gaps)}")
    print(f"arrival minus E (local clock, which runs about 250 ms ahead of the server): median {statistics.median(lags):.0f} ms, p95 {sorted(lags)[int(len(lags) * 0.95)]:.0f} ms")
    print(f"field changes between consecutive frames, out of {changes['pairs']}: mark p {changes['p']}, index I {changes['I']}, funding r {changes['r']}, next funding T {changes['T']}")
    print("fields present:", sorted(set().union(*[d.keys() for fr in rows.values() for _, d in fr])))

    now = time.time() * 1000
    mismatch, by_cycle = [], collections.Counter()
    for sid in delivered:
        d = rows[sid][-1][1]
        cycle = live[sid]["settleCycle"]
        hours_ahead = (d["T"] - now) / 3_600_000
        on_grid = d["T"] % (cycle * 3_600_000) == 0
        by_cycle[(cycle, on_grid, 0 < hours_ahead <= cycle)] += 1
        if not (on_grid and 0 < hours_ahead <= cycle):
            mismatch.append((sid, cycle, d["T"]))
    print(f"T against settleCycle, (cycle hours, T on the UTC grid of that cycle, T within one cycle ahead): {dict(by_cycle)}")
    print("contracts whose T does not fit settleCycle:", mismatch[:10])
    cap_hits = [(sid, rows[sid][-1][1]["r"], live[sid]["fundRateLimit"]) for sid in delivered if abs(float(rows[sid][-1][1]["r"])) >= float(live[sid]["fundRateLimit"]) - 1e-12]
    print(f"contracts whose |r| equals or exceeds fundRateLimit: {len(cap_hits)} {cap_hits[:8]}")
    btc = rows["BTC-USDT-M"][-1][1]
    print("BTC-USDT-M last frame:", json.dumps(btc), "mark minus index ppm", round((float(btc["p"]) / float(btc["I"]) - 1) * 1e6))

    try:
        bn = {x["symbol"]: x for x in fetch(BINANCE)}
    except Exception as e:  # a refusal is a fact to record, not a reason to stop
        print(f"Binance premiumIndex failed: {e}")
        return
    same_rate, shared, idx_ppm = 0, 0, []
    examples = []
    for sid in delivered:
        sym = live[sid]["symbolName"]
        if sym not in bn:
            continue
        shared += 1
        mine = rows[sid][-1][1]
        if float(mine["r"]) == float(bn[sym]["lastFundingRate"]):
            same_rate += 1
        elif len(examples) < 6:
            examples.append((sym, mine["r"], bn[sym]["lastFundingRate"]))
        if float(bn[sym]["indexPrice"]) > 0:
            idx_ppm.append((abs(float(mine["I"]) / float(bn[sym]["indexPrice"]) - 1) * 1e6, sym, mine["I"], bn[sym]["indexPrice"]))
    print(f"Binance USD-M premiumIndex: {len(bn)} symbols, {shared} shared by symbolName")
    print(f"BitTap r equal to Binance lastFundingRate on {same_rate} of {shared}, differing examples {examples}")
    idx_ppm.sort()
    ppm = [x[0] for x in idx_ppm]
    print(f"|BitTap I / Binance indexPrice - 1| in ppm: median {statistics.median(ppm):.0f}, p90 {ppm[int(len(ppm) * 0.9)]:.0f}, max {ppm[-1]:.0f}")
    print("largest index differences (ppm, symbol, BitTap I, Binance indexPrice):", [(round(a), b, c, d) for a, b, c, d in idx_ppm[-4:]])


if __name__ == "__main__":
    asyncio.run(main())
