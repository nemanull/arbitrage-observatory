# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for the OneBullEx futures open API at futures-openapi.onebullex.com.

Public, unauthenticated, read-only, at most about two requests per second.
The venue publishes no public rate limit, see docs/profiles/onebullex/rest.md section 6.

Prints one JSON line per finding.
The findings are host and timing, catalog counts, the bulk anchor calls, stale rows outside the catalog, a funding sample against its history, the REST book, error shapes, the server clock offset, and a CCXT id search.

Run from the repository root:
    uv run scripts/probes/venues/onebullex/rest-probe.py

Set PROBE_OUT_DIR to keep raw replies, for example .claude/survey-work/onebullex/rest.
Recorded in docs/profiles/onebullex/rest.md, fees.md and websocket.md.
"""

import collections
import json
import os
import socket
import statistics
import time
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://futures-openapi.onebullex.com"
HOST = "futures-openapi.onebullex.com"
OUT = os.environ.get("PROBE_OUT_DIR")
CCXT_SRC = Path("node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src")
SAMPLE = ["btc_usdt", "eth_usdt", "sol_usdt", "xrp_usdt", "doge_usdt", "bnb_usdt"]


def emit(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, ensure_ascii=False), flush=True)


def get(path, save=None, timeout=40):
    url = BASE + path
    req = urllib.request.Request(url, headers={"User-Agent": "survey-probe/1.0", "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, dict(e.headers)
    ms = round((time.perf_counter() - t0) * 1000)
    if OUT and save:
        Path(OUT).mkdir(parents=True, exist_ok=True)
        (Path(OUT) / save).write_bytes(body)
    try:
        data = json.loads(body)
    except ValueError:
        data = None
    time.sleep(0.5)
    return status, ms, len(body), headers, data, body


def host_and_timing():
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443)})
    times = [get("/v2/public/time")[1] for _ in range(6)]
    emit("host", host=HOST, addresses=addrs, cold_ms=times[0], warm_ms=times[1:], warm_median_ms=statistics.median(times[1:]))
    status, ms, size, headers, data, _ = get("/v2/public/time")
    limit_headers = {k: v for k, v in headers.items() if "limit" in k.lower() or "retry" in k.lower()}
    emit("headers", status=status, server=headers.get("Server"), cf_ray=headers.get("CF-Ray"), rate_limit_headers=limit_headers)


def clock():
    offsets = []
    for _ in range(5):
        t0 = time.time() * 1000
        _, _, _, _, data, _ = get("/v2/public/time")
        t1 = time.time() * 1000
        offsets.append(data["data"] - (t0 + t1) / 2)
    emit("clock", reply_unit="ms", sample=data["data"], offsets_ms=[round(o) for o in offsets], median_offset_ms=round(statistics.median(offsets)))


def catalog():
    status, ms, size, _, data, _ = get("/v2/public/symbol/list", "symbol-list.json")
    rows = data["data"]
    by = collections.Counter((r["contractType"], r["underlyingType"], r["quoteCoin"], r["state"], r["tradeSwitch"]) for r in rows)
    fees = collections.Counter((r["makerFee"], r["takerFee"], r["liquidationFee"]) for r in rows)
    sizes = collections.Counter(r["contractSize"] for r in rows)
    btc = next(r for r in rows if r["symbol"] == "btc_usdt")
    emit("catalog", status=status, ms=ms, bytes=size, count=len(rows),
         by_type_underlying_quote_state_switch=[[list(k), v] for k, v in by.items()],
         fees_maker_taker_liquidation=[[list(k), v] for k, v in fees.items()],
         contract_sizes=sizes.most_common(),
         duplicate_symbols=[s for s, n in collections.Counter(r["symbol"] for r in rows).items() if n > 1],
         plates=sorted(collections.Counter(p for r in rows for p in (r.get("plateList") or [])).items()),
         plate_8=[r["symbol"] for r in rows if 8 in (r.get("plateList") or [])],
         no_plate=sum(1 for r in rows if not r.get("plateList")),
         btc={k: btc[k] for k in ("symbol", "contractSize", "quantityPrecision", "pricePrecision", "minQty", "minStepPrice", "makerFee", "takerFee", "depthPrecisionMerge")})
    status, ms, size, _, data, _ = get("/v2/public/symbol/all", "symbol-all.json")
    emit("symbol_all", status=status, ms=ms, bytes=size, count=len(data["data"]), not_in_list=len(set(data["data"]) - {r["symbol"] for r in rows}))
    return {r["symbol"] for r in rows}


def bulk(listed):
    out = {}
    for name, path in (("agg_tickers", "/v2/public/q/agg-tickers?timeRangeType=H24"),
                       ("tickers", "/v2/public/q/tickers?timeRangeType=H24"),
                       ("mark_price", "/v2/public/q/mark-price"),
                       ("index_price", "/v2/public/q/index-price")):
        runs = []
        for _ in range(3):
            status, ms, size, _, data, _ = get(path, name + ".json")
            runs.append(ms)
        rows = data["data"]
        syms = {r["s"] for r in rows}
        now = int(time.time() * 1000)
        stale = [r for r in rows if r["s"] not in listed]
        stale_age_h = sorted(round((now - r["t"]) / 3_600_000) for r in stale)
        listed_age_s = sorted(round((now - r["t"]) / 1000) for r in rows if r["s"] in listed)
        emit("bulk", call=name, path=path, status=status, bytes=size, ms_runs=runs, rows=len(rows),
             listed_rows=len(syms & listed), listed_missing=len(listed - syms), stale_rows=len(stale),
             stale_age_hours_min_max=[stale_age_h[0], stale_age_h[-1]] if stale_age_h else None,
             listed_age_s_median=statistics.median(listed_age_s) if listed_age_s else None,
             first_row=rows[0])
        out[name] = rows
    agg = {r["s"]: r for r in out["agg_tickers"] if r["s"] in listed}
    mark = {r["s"]: r["p"] for r in out["mark_price"]}
    index = {r["s"]: r["p"] for r in out["index_price"]}
    emit("bulk_compare", listed=len(agg),
         agg_mark_equal_mark_call=sum(1 for s, r in agg.items() if r["m"] == mark.get(s)),
         agg_index_equal_index_call=sum(1 for s, r in agg.items() if r["i"] == index.get(s)),
         agg_mark_equal_index=sum(1 for r in agg.values() if r["m"] == r["i"]),
         agg_mark_equal_last=sum(1 for r in agg.values() if r["m"] == r["c"]),
         empty_bid_or_ask=sum(1 for r in agg.values() if not r["bp"] or not r["ap"]))


def funding():
    status, ms, size, _, data, body = get("/v2/public/q/funding-rate")
    emit("funding_no_symbol", status=status, body=body.decode()[:200])
    for s in SAMPLE:
        status, ms, size, _, cur, _ = get(f"/v2/public/q/funding-rate?symbol={s}")
        hstatus, hms, _, _, hist, hbody = get(f"/v2/public/q/funding-rate-record?symbol={s}&limit=6", f"funding-record-{s}.json", timeout=60)
        items = (hist or {}).get("data", {}) or {}
        items = items.get("items", []) if isinstance(items, dict) else []
        emit("funding", symbol=s, status=status, ms=ms, current=cur.get("data"),
             history_status=hstatus, history_ms=hms,
             history=[[i["createdTime"], i["fundingRate"], i["collectionInterval"]] for i in items],
             current_equals_last_settled=bool(items) and cur["data"]["fundingRate"] == items[0]["fundingRate"],
             history_body=None if items else hbody.decode()[:200])


def book():
    for level in (1, 5, 50, 51, 100, 1000, 0):
        status, ms, size, _, data, body = get(f"/v2/public/q/depth?symbol=btc_usdt&level={level}", f"depth-{level}.json")
        d = (data or {}).get("data") or {}
        if isinstance(d, dict) and "b" in d:
            bids, asks = d["b"], d["a"]
            emit("depth", level=level, status=status, ms=ms, bytes=size, bids=len(bids), asks=len(asks), u=d.get("u"), t=d.get("t"),
                 bids_desc=all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1)),
                 asks_asc=all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1)),
                 best=[bids[0] if bids else None, asks[0] if asks else None])
        else:
            emit("depth", level=level, status=status, ms=ms, body=body.decode()[:200])
    us = []
    for _ in range(3):
        _, _, _, headers, data, _ = get("/v2/public/q/depth?symbol=btc_usdt&level=50")
        us.append([data["data"]["u"], data["data"]["t"], headers.get("CF-Cache-Status"), headers.get("Cache-Control")])
    emit("depth_repeat", u_t_cache=us)


def errors():
    for path in ("/v2/public/q/depth?symbol=nope_usdt&level=5",
                 "/v2/public/q/funding-rate?symbol=nope_usdt",
                 "/v2/public/symbol/detail?symbol=nope_usdt",
                 "/v2/public/q/agg-ticker?symbol=BTC_USDT&timeRangeType=H24",
                 "/v2/public/q/agg-ticker?symbol=btc_usdt",
                 "/v2/public/nope",
                 "/v2/balance/list"):
        status, ms, size, headers, data, body = get(path)
        emit("error_shape", path=path, status=status, body=body.decode(errors="replace")[:240])


def ccxt():
    ids = sorted(p.stem for p in CCXT_SRC.glob("*.js")) if CCXT_SRC.exists() else []
    emit("ccxt", path=str(CCXT_SRC), classes=len(ids), matches=[i for i in ids if "bull" in i or i.startswith("one") or "obe" in i])


def main():
    host_and_timing()
    clock()
    listed = catalog()
    bulk(listed)
    funding()
    book()
    errors()
    ccxt()


if __name__ == "__main__":
    main()
