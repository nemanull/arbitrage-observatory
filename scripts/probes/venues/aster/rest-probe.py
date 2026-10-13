# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Read-only public REST probe for Aster perpetuals, the fapi host that CCXT calls `aster`.

Modes, all in turn by default, or name some on the command line:
    host      DNS, edge headers, cold and warm request times of the calls a catalog, a poller and a resync use.
    catalog   /fapi/v3/exchangeInfo and /fapi/v1/exchangeInfo: statuses, quote families, flags, special markets.
    anchor    /fapi/v3/premiumIndex and /fapi/v3/fundingInfo for every symbol at once, with the row mapping checks.
    cadence   60 bulk premiumIndex polls one second apart, counting how often index, mark and rate change.
    refs      /fapi/v3/indexreferences for a sample of markets, which names the index basket.
    funding   /fapi/v3/fundingRate history for a few markets, to read the settlement instants and intervals.
    book      /fapi/v3/depth at each documented limit, level order, ids and caching.
    errors    unknown symbols, bad parameters and paths, with status, body and rate limit headers.
    time      /fapi/v3/time against the local clock on the fastest of ten calls.

Public, unauthenticated, read-only calls only, well inside the documented 2,400 weight a minute.
Run from the repository root:
    uv run scripts/probes/venues/aster/rest-probe.py [mode ...]
Captures go to .claude/survey-work/aster/.
"""

import collections
import json
import socket
import statistics
import sys
import time
from pathlib import Path

import httpx

HOST = "fapi.asterdex.com"
BASE = f"https://{HOST}"
WORK = Path(".claude/survey-work/aster")
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"}
FAMILY = ("USDT", "USDC", "USD")  # the quotes the engine keeps


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def client() -> httpx.Client:
    return httpx.Client(base_url=BASE, headers=UA, timeout=20.0, http2=False)


def timed(c: httpx.Client, path: str, **params):
    t0 = time.perf_counter()
    r = c.get(path, params=params or None)
    ms = (time.perf_counter() - t0) * 1000
    return r, ms


def edge(r: httpx.Response) -> dict:
    keep = ("x-amz-cf-pop", "x-cache", "via", "server", "x-mbx-used-weight-1m", "x-response-time", "retry-after", "content-encoding", "cache-control", "age")
    return {k: r.headers.get(k) for k in keep if r.headers.get(k) is not None}


def mode_host() -> None:
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    out(mode="host", host=HOST, addresses=addrs)
    for ws_host in ("fstream.asterdex.com", "sapi.asterdex.com"):
        out(mode="host", host=ws_host, addresses=sorted({a[4][0] for a in socket.getaddrinfo(ws_host, 443, proto=socket.IPPROTO_TCP)}))
    calls = [
        ("/fapi/v3/time", {}),
        ("/fapi/v3/exchangeInfo", {}),
        ("/fapi/v3/premiumIndex", {}),
        ("/fapi/v3/fundingInfo", {}),
        ("/fapi/v3/depth", {"symbol": "BTCUSDT", "limit": 20}),
        ("/fapi/v3/ticker/bookTicker", {}),
    ]
    for path, params in calls:
        with client() as c:  # a fresh client, so the first request carries DNS, TCP and TLS
            r, cold = timed(c, path, **params)
            warm = []
            for _ in range(5):
                r2, ms = timed(c, path, **params)
                warm.append(round(ms, 1))
                time.sleep(0.2)
        out(mode="host", path=path, params=params, status=r.status_code, cold_ms=round(cold, 1), warm_ms=warm,
            warm_median=statistics.median(warm), bytes=len(r.content), headers=edge(r2))
        time.sleep(0.5)


def symbols_of(info: dict) -> list:
    return info.get("symbols", [])


def mode_catalog() -> None:
    with client() as c:
        v3, ms3 = timed(c, "/fapi/v3/exchangeInfo")
        v1, ms1 = timed(c, "/fapi/v1/exchangeInfo")
    (WORK / "exchangeInfo-v3.json").write_bytes(v3.content)
    i3, i1 = v3.json(), v1.json()
    s3, s1 = symbols_of(i3), symbols_of(i1)
    out(mode="catalog", v3_ms=round(ms3), v3_bytes=len(v3.content), v3_rows=len(s3), v1_ms=round(ms1), v1_rows=len(s1),
        same_symbols=sorted(x["symbol"] for x in s3) == sorted(x["symbol"] for x in s1), rate_limits=i3.get("rateLimits"))
    out(mode="catalog", status_contract_quote_margin=collections.Counter(
        f'{x.get("status")}|{x.get("contractType")}|{x.get("quoteAsset")}|{x.get("marginAsset")}' for x in s3).most_common())
    kept = [x for x in s3 if x.get("status") == "TRADING" and x.get("contractType") == "PERPETUAL" and x.get("quoteAsset") in FAMILY and x.get("marginAsset") == x.get("quoteAsset")]
    out(mode="catalog", kept_trading_perpetual_usd_family=len(kept))
    out(mode="catalog", fields=sorted({k for x in s3 for k in x}))
    out(mode="catalog", contract_size_fields=collections.Counter(str((x.get("contractSize"), x.get("unit"))) for x in s3))
    out(mode="catalog", symbolType_tradingMode_channel=collections.Counter(f'{x.get("symbolType")}|{x.get("tradingMode")}|{x.get("channel")}' for x in s3).most_common())
    out(mode="catalog", subtypes_of_kept=collections.Counter("+".join(x.get("underlyingSubType") or []) or "(none)" for x in kept).most_common())
    out(mode="catalog", aos2=[(x["symbol"], x["status"], x["quoteAsset"]) for x in s3 if "AOS2" in (x.get("underlyingSubType") or [])])
    out(mode="catalog", pre_launch=[(x["symbol"], x["status"], x["quoteAsset"]) for x in s3 if "pre-launch" in (x.get("underlyingSubType") or [])])
    out(mode="catalog", non_ascii=[x["symbol"] for x in s3 if not x["symbol"].isascii()])
    out(mode="catalog", settling=[x["symbol"] for x in s3 if x.get("status") == "SETTLING"])
    out(mode="catalog", pending=[(x["symbol"], x.get("contractType")) for x in s3 if x.get("status") == "PENDING_TRADING"])
    out(mode="catalog", other_quotes=[x["symbol"] for x in s3 if x.get("quoteAsset") not in FAMILY])
    bases = collections.Counter(x["baseAsset"] for x in s3 if x.get("status") == "TRADING")
    out(mode="catalog", base_listed_twice=sorted((b, n) for b, n in bases.items() if n > 1))
    out(mode="catalog", digit_prefixed_kept=[x["symbol"] for x in kept if x["baseAsset"][:1].isdigit()])
    out(mode="catalog", tick_and_step_sample=[(x["symbol"], next((f.get("tickSize") for f in x["filters"] if f["filterType"] == "PRICE_FILTER"), None),
                                              next((f.get("stepSize") for f in x["filters"] if f["filterType"] == "LOT_SIZE"), None)) for x in kept[:5]])


def mode_anchor() -> None:
    with client() as c:
        info = c.get("/fapi/v3/exchangeInfo").json()
        prem, pms = timed(c, "/fapi/v3/premiumIndex")
        fi, fms = timed(c, "/fapi/v3/fundingInfo")
        prem1, p1ms = timed(c, "/fapi/v1/premiumIndex")
    local = int(time.time() * 1000)
    (WORK / "premiumIndex.json").write_bytes(prem.content)
    (WORK / "fundingInfo.json").write_bytes(fi.content)
    rows, frows = prem.json(), fi.json()
    status = {x["symbol"]: x["status"] for x in symbols_of(info)}
    kept = {x["symbol"] for x in symbols_of(info) if x.get("status") == "TRADING" and x.get("quoteAsset") in FAMILY and x.get("contractType") == "PERPETUAL"}
    out(mode="anchor", premium_rows=len(rows), premium_ms=round(pms), premium_bytes=len(prem.content), premium_headers=edge(prem),
        v1_rows=len(prem1.json()), v1_ms=round(p1ms), funding_info_rows=len(frows), funding_info_ms=round(fms), funding_info_bytes=len(fi.content), funding_info_headers=edge(fi))
    out(mode="anchor", premium_fields=sorted({k for r in rows for k in r}), funding_info_fields=sorted({k for r in frows for k in r}))
    psyms = {r["symbol"] for r in rows}
    out(mode="anchor", kept_missing_from_premium=sorted(kept - psyms), premium_not_in_catalog=sorted(psyms - set(status)),
        premium_by_status=collections.Counter(status.get(s, "absent") for s in psyms))
    zero = [r["symbol"] for r in rows if r["symbol"] in kept and (float(r.get("markPrice") or 0) == 0 or float(r.get("indexPrice") or 0) == 0)]
    out(mode="anchor", kept_with_zero_mark_or_index=zero)
    nft = collections.Counter(r.get("nextFundingTime") for r in rows if r["symbol"] in kept)
    out(mode="anchor", next_funding_times=sorted(nft.items()))
    ages = [local - int(r["time"]) for r in rows if r["symbol"] in kept and r.get("time")]
    out(mode="anchor", row_time_age_ms={"min": min(ages), "median": statistics.median(ages), "max": max(ages)}, distinct_row_times=len({r.get("time") for r in rows}))
    fsyms = {r["symbol"] for r in frows}
    out(mode="anchor", kept_missing_from_funding_info=sorted(kept - fsyms), funding_info_not_kept=sorted(fsyms - kept)[:40])
    out(mode="anchor", intervals=collections.Counter(r.get("fundingIntervalHours") for r in frows if r["symbol"] in kept),
        caps=collections.Counter((r.get("fundingFeeCap"), r.get("fundingFeeFloor")) for r in frows if r["symbol"] in kept).most_common(),
        interest=collections.Counter(r.get("interestRate") for r in frows if r["symbol"] in kept).most_common())
    by = {r["symbol"]: r for r in rows}
    fby = {r["symbol"]: r for r in frows}
    for s in ("BTCUSDT", "ETHUSDT", "ASTERUSDT", "AAPLUSDT", "XAUUSDT", "OPENAIUSDT", "币安人生USDT"):
        out(mode="anchor", sample=by.get(s), funding_info=fby.get(s))
    # Does nextFundingTime follow fundingIntervalHours, and is it on the hour?
    mism = []
    for s in kept & psyms & fsyms:
        h = fby[s].get("fundingIntervalHours")
        t = by[s].get("nextFundingTime")
        if h and t and (t // 3_600_000) % h != 0:
            mism.append((s, h, t))
    out(mode="anchor", next_funding_off_interval_grid=mism[:20], count=len(mism))
    est = collections.Counter(r.get("estimatedSettlePrice") in (None, "", "0", "0.00000000") for r in rows if r["symbol"] in kept)
    out(mode="anchor", estimated_settle_empty=est)


def mode_cadence(polls: int = 60) -> None:
    last, changes, ms_list, holds = {}, collections.Counter(), [], {}
    times, ages = [], []
    watch = ("BTCUSDT", "ETHUSDT", "ASTERUSDT", "AAPLUSDT", "XAUUSDT", "OPENAIUSDT")
    with client() as c:
        kept = {x["symbol"] for x in c.get("/fapi/v3/exchangeInfo").json()["symbols"] if x.get("status") == "TRADING" and x.get("quoteAsset") in FAMILY}
        start = time.time()
        for i in range(polls):
            target = start + i
            time.sleep(max(0.0, target - time.time()))
            r, ms = timed(c, "/fapi/v3/premiumIndex")
            arrival = int(time.time() * 1000)
            ms_list.append(ms)
            rows = {x["symbol"]: x for x in r.json() if x["symbol"] in kept}
            times.append(len({x.get("time") for x in rows.values()}))
            ages.append(statistics.median(arrival - int(x["time"]) for x in rows.values()))
            for s, x in rows.items():
                cur = (x["indexPrice"], x["markPrice"], x["lastFundingRate"], x["nextFundingTime"])
                if s in last:
                    for k, (a, b) in enumerate(zip(last[s], cur)):
                        if a != b:
                            changes[(s, k)] += 1
                last[s] = cur
            if i % 15 == 0:
                out(mode="cadence", poll=i, ms=round(ms), weight=r.headers.get("x-mbx-used-weight-1m"))
    n = len(last)
    tot = {name: sum(changes[(s, k)] for s in last) / max(1, n) for k, name in enumerate(("index", "mark", "rate", "next"))}
    out(mode="cadence", polls=polls, markets=n, mean_changes_per_market=tot,
        ms={"min": round(min(ms_list)), "median": round(statistics.median(ms_list)), "p90": round(sorted(ms_list)[int(0.9 * len(ms_list))]), "max": round(max(ms_list))},
        distinct_time_values_per_reply={"min": min(times), "max": max(times)}, median_row_age_ms={"min": min(ages), "median": statistics.median(ages), "max": max(ages)})
    never = [s for s in last if changes[(s, 1)] == 0]
    out(mode="cadence", markets_whose_mark_never_changed=len(never), sample=never[:15])
    for s in watch:
        out(mode="cadence", market=s, index=changes[(s, 0)], mark=changes[(s, 1)], rate=changes[(s, 2)], next=changes[(s, 3)])


def mode_refs() -> None:
    sample = ["BTCUSDT", "ETHUSDT", "ASTERUSDT", "1000PEPEUSDT", "AAPLUSDT", "TSLAUSDT", "XAUUSDT", "CLUSDT", "TENCENTUSDT",
              "OPENAIUSDT", "ANTHROPICUSDT", "SPCXUSDT", "币安人生USDT", "EURUSDUSDT", "SKHYNIXUSDT", "BTCUSD1", "BTCU"]
    with client() as c:
        info = c.get("/fapi/v3/exchangeInfo").json()
        known = {x["symbol"] for x in info["symbols"]}
        forex = [x["symbol"] for x in info["symbols"] if x.get("channel") == "forex"][:2]
        for s in sample + forex:
            if s not in known:
                out(mode="refs", symbol=s, note="not in catalog")
                continue
            r, ms = timed(c, "/fapi/v3/indexreferences", symbol=s)
            body = r.json() if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
            refs = body.get("references") if isinstance(body, dict) else None
            out(mode="refs", symbol=s, status=r.status_code, ms=round(ms),
                sources=[(x.get("exchange"), x.get("symbol"), x.get("weight")) for x in refs] if refs else body)
            time.sleep(0.25)


def mode_funding() -> None:
    with client() as c:
        fi = {r["symbol"]: r for r in c.get("/fapi/v3/fundingInfo").json()}
        picks = ["BTCUSDT", "ASTERUSDT", "AAPLUSDT"]
        for h in (1, 4):
            s = next((k for k, v in fi.items() if v.get("fundingIntervalHours") == h), None)
            if s:
                picks.append(s)
        for s in picks:
            r, ms = timed(c, "/fapi/v3/fundingRate", symbol=s, limit=6)
            rows = r.json()
            out(mode="funding", symbol=s, interval=fi.get(s, {}).get("fundingIntervalHours"), status=r.status_code,
                rows=[(x.get("fundingTime"), time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(int(x["fundingTime"]) / 1000)), x.get("fundingRate")) for x in rows] if isinstance(rows, list) else rows)
            time.sleep(0.25)
        p = {r["symbol"]: r for r in c.get("/fapi/v3/premiumIndex").json()}
        for s in picks:
            out(mode="funding", symbol=s, now_lastFundingRate=p.get(s, {}).get("lastFundingRate"), nextFundingTime=p.get(s, {}).get("nextFundingTime"))


def mode_book() -> None:
    with client() as c:
        for limit in (5, 10, 20, 50, 100, 500, 1000):
            r, ms = timed(c, "/fapi/v3/depth", symbol="BTCUSDT", limit=limit)
            arrival = int(time.time() * 1000)
            b = r.json()
            bids, asks = b.get("bids", []), b.get("asks", [])
            out(mode="book", limit=limit, status=r.status_code, ms=round(ms), bytes=len(r.content), bids=len(bids), asks=len(asks),
                bids_desc=all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1)),
                asks_asc=all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1)),
                lastUpdateId=b.get("lastUpdateId"), E_age_ms=arrival - b["E"] if b.get("E") else None, T_age_ms=arrival - b["T"] if b.get("T") else None,
                weight=r.headers.get("x-mbx-used-weight-1m"), keys=sorted(b))
            time.sleep(0.3)
        ids = []
        for _ in range(4):
            b = c.get("/fapi/v3/depth", params={"symbol": "BTCUSDT", "limit": 5}).json()
            ids.append((b.get("lastUpdateId"), b.get("E")))
            time.sleep(0.25)
        out(mode="book", four_reads_250ms_apart=ids)
        r = c.get("/fapi/v3/depth", params={"symbol": "BTCUSDT"})
        out(mode="book", default_limit_levels=len(r.json().get("bids", [])))
        for s in ("TONUSDT", "AFEEUSDT", "币安人生USDT", "OPENAIUSDT", "B-MONEYUSDT"):
            r = c.get("/fapi/v3/depth", params={"symbol": s, "limit": 20})
            arrival = int(time.time() * 1000)
            b = r.json()
            out(mode="book", symbol=s, status=r.status_code, bids=len(b.get("bids", [])) if isinstance(b, dict) else None,
                asks=len(b.get("asks", [])) if isinstance(b, dict) else None, body=None if isinstance(b, dict) and "bids" in b else b,
                E_age_ms=arrival - b["E"] if isinstance(b, dict) and b.get("E") else None)  # on a quiet book E is its last change
            time.sleep(0.25)
        r = c.get("/fapi/v3/depth", params={"symbol": "BTCUSDT", "limit": 20}).json()
        out(mode="book", btc_top=(r["bids"][0], r["asks"][0]))


def mode_errors() -> None:
    cases = [
        ("/fapi/v3/depth", {"symbol": "NOPEUSDT"}),
        ("/fapi/v3/depth", {"symbol": "btcusdt"}),
        ("/fapi/v3/depth", {"symbol": "BTCUSDT", "limit": 7}),
        ("/fapi/v3/premiumIndex", {"symbol": "NOPEUSDT"}),
        ("/fapi/v3/indexreferences", {"symbol": "NOPEUSDT"}),
        ("/fapi/v3/indexreferences", {}),
        ("/fapi/v3/fundingInfo", {"symbol": "NOPEUSDT"}),
        ("/fapi/v3/nope", {}),
    ]
    with client() as c:
        for path, params in cases:
            r = c.get(path, params=params or None)
            out(mode="errors", path=path, params=params, status=r.status_code, content_type=r.headers.get("content-type"),
                body=r.text[:300], retry_after=r.headers.get("retry-after"), weight=r.headers.get("x-mbx-used-weight-1m"))
            time.sleep(0.25)
        r = c.post("/fapi/v3/premiumIndex")
        out(mode="errors", path="POST /fapi/v3/premiumIndex", status=r.status_code, body=r.text[:200])
        r = c.get("/fapi/v3/time")
        out(mode="errors", time_headers=dict(r.headers))


def mode_time() -> None:
    best = None
    with client() as c:
        c.get("/fapi/v3/time")
        for _ in range(10):
            t0 = time.time()
            st = c.get("/fapi/v3/time").json()["serverTime"]
            t1 = time.time()
            rtt = (t1 - t0) * 1000
            lo, hi = t0 * 1000 - st, t1 * 1000 - st  # local minus server, bounded by the round trip
            if best is None or rtt < best[0]:
                best = (rtt, lo, hi)
            time.sleep(0.2)
    out(mode="time", best_rtt_ms=round(best[0], 1), local_minus_server_ms=(round(best[1], 1), round(best[2], 1)))


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "cadence": mode_cadence, "refs": mode_refs,
         "funding": mode_funding, "book": mode_book, "errors": mode_errors, "time": mode_time}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    picked = sys.argv[1:] or list(MODES)
    for m in picked:
        out(mode=m, started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        MODES[m]()
