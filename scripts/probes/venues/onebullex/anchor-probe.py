# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only anchor probe for the OneBullEx futures open API at futures-openapi.onebullex.com.

Public, unauthenticated, read-only, at most about two requests per second.

Modes, each printing one JSON line per finding:
    poll    60 polls about one second apart of agg-tickers and funding-rate for btc_usdt, then how often each number changed.
    sweep   funding-rate for every listed contract, one at a time, then one funding history read per nextCollectionTime group for its interval.
    all     both, about four minutes.

Run from the repository root:
    uv run scripts/probes/venues/onebullex/anchor-probe.py [poll|sweep|all]

Recorded in docs/profiles/onebullex/rest.md sections 3, 4 and 8.
"""

import collections
import json
import statistics
import sys
import time
import urllib.request

BASE = "https://futures-openapi.onebullex.com"
WATCH = ["btc_usdt", "eth_usdt", "sol_usdt", "doge_usdt"]


def emit(kind, **fields):
    print(json.dumps({"kind": kind, **fields}), flush=True)


def get(path, timeout=30):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "survey-probe/1.0"})
    t0 = time.perf_counter()
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    return json.loads(body), round((time.perf_counter() - t0) * 1000), len(body)


def listed():
    data, _, _ = get("/v2/public/symbol/list")
    return [r["symbol"] for r in data["data"]]


def poll():
    syms = set(listed())
    seen = collections.defaultdict(list)
    times, ftimes = [], []
    end = time.monotonic() + 62
    n = 0
    while time.monotonic() < end and n < 60:
        start = time.monotonic()
        data, ms, size = get("/v2/public/q/agg-tickers?timeRangeType=H24")
        times.append(ms)
        for r in data["data"]:
            if r["s"] in syms:
                seen[r["s"]].append((r["t"], r["c"], r["i"], r["m"]))
        f, fms, _ = get("/v2/public/q/funding-rate?symbol=btc_usdt")
        ftimes.append(fms)
        seen["funding:btc_usdt"].append((f["data"]["fundingRate"], f["data"]["nextCollectionTime"]))
        n += 1
        time.sleep(max(0.0, 1.0 - (time.monotonic() - start)))
    emit("poll_timing", polls=n, agg_ms_median=statistics.median(times), agg_ms_max=max(times), agg_bytes=size,
         funding_ms_median=statistics.median(ftimes))
    for s in WATCH:
        rows = seen[s]
        emit("poll_changes", symbol=s, polls=len(rows),
             distinct_t=len({r[0] for r in rows}), distinct_last=len({r[1] for r in rows}),
             distinct_index=len({r[2] for r in rows}), distinct_mark=len({r[3] for r in rows}),
             mark_equal_index=sum(1 for r in rows if r[2] == r[3]))
    all_changes = [len({r[3] for r in seen[s]}) for s in syms]
    idx_changes = [len({r[2] for r in seen[s]}) for s in syms]
    emit("poll_changes_all", contracts=len(syms),
         mark_distinct_median=statistics.median(all_changes), mark_never_changed=sum(1 for c in all_changes if c == 1),
         index_distinct_median=statistics.median(idx_changes), index_never_changed=sum(1 for c in idx_changes if c == 1),
         mark_equal_index_rows=sum(1 for s in syms for r in seen[s] if r[2] == r[3]),
         rows=sum(len(seen[s]) for s in syms))
    fr = seen["funding:btc_usdt"]
    emit("poll_funding", symbol="btc_usdt", distinct=sorted({r[0] for r in fr}), next=sorted({r[1] for r in fr}))


def sweep():
    syms = listed()
    t0 = time.monotonic()
    nexts, rates, mss, errs, null_rates, by_next = collections.Counter(), [], [], [], [], {}
    for s in syms:
        try:
            data, ms, _ = get(f"/v2/public/q/funding-rate?symbol={s}")
        except Exception as e:  # noqa: BLE001 record and move on
            errs.append([s, repr(e)[:120]])
            time.sleep(0.45)
            continue
        mss.append(ms)
        if data.get("code") != 0 or not data.get("data"):
            errs.append([s, json.dumps(data)[:120]])
            continue
        nexts[data["data"]["nextCollectionTime"]] += 1
        by_next.setdefault(data["data"]["nextCollectionTime"], []).append(s)
        if data["data"]["fundingRate"] is None:
            null_rates.append([s, data["data"]])
        else:
            rates.append(float(data["data"]["fundingRate"]))
        time.sleep(0.45)
    emit("sweep", contracts=len(syms), answered=len(rates), null_rate=null_rates[:10], null_rate_count=len(null_rates), errors=errs[:10], wall_s=round(time.monotonic() - t0, 1),
         ms_median=statistics.median(mss), ms_max=max(mss),
         next_collection_times=sorted(nexts.items(), key=lambda kv: str(kv[0])),
         rate_min=min(rates), rate_max=max(rates),
         at_plus_0_0001=sum(1 for r in rates if abs(r - 0.0001) < 1e-12))
    for nxt, group in sorted(by_next.items(), key=lambda kv: str(kv[0])):
        sym = group[0]
        try:
            hist, ms, _ = get(f"/v2/public/q/funding-rate-record?symbol={sym}&limit=3", timeout=90)
        except Exception as e:  # noqa: BLE001 the history call is slow, record and move on
            emit("sweep_interval", next_collection_time=nxt, contracts=len(group), sample=sym, error=repr(e)[:120])
            continue
        items = ((hist.get("data") or {}).get("items") or []) if isinstance(hist.get("data"), dict) else []
        emit("sweep_interval", next_collection_time=nxt, contracts=len(group), sample=sym, sample_more=group[1:6], history_ms=ms,
             history=[[i["createdTime"], i["fundingRate"], i["collectionInterval"]] for i in items])
        time.sleep(0.5)


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("poll", "all"):
        poll()
    if mode in ("sweep", "all"):
        sweep()


if __name__ == "__main__":
    main()
