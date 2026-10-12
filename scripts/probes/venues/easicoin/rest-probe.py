# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""EasiCoin REST probe: hosts, the web app's catalog, fee fields, anchor candidates, REST book, rate limit headers and server time.

EasiCoin documents no public API, so every path here is one the www.easicoin.io web app calls, found in its script bundles.
Public, unauthenticated and read-only, with pauses of 300 ms or more between calls.

Run from the repository root:
  uv run scripts/probes/venues/easicoin/rest-probe.py [catalog|access|anchor|book|time]
    catalog  DNS, catalog latency, perpetual families, statuses, fee fields, names, index sources, spot pair count
    access   status of the site, the docs, the candidate API hosts and the region check calls
    anchor   funding and mark history, the risk pool call and bulk ticker guesses
    book     REST order book guesses for one perpetual and one spot pair
    time     server time against the local clock, and the response headers
Set PROBE_OUT_DIR to keep raw replies.
Recorded in docs/profiles/easicoin/rest.md and fees.md.
"""

import collections
import json
import os
import socket
import statistics
import sys
import time
from datetime import datetime, timezone

import httpx

WWW = "https://www.easicoin.io"
MAPI = f"{WWW}/mapi"
CATALOG = f"{MAPI}/trade/public/v1/market/dynamic_symbol"
OUT = os.environ.get("PROBE_OUT_DIR")
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) venue-survey-probe", "Accept": "application/json"}


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, default=str), flush=True)


def keep(name, text):
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "w") as f:
            f.write(text)


def count(rows, key):
    return dict(collections.Counter(str(key(r)) for r in rows).most_common())


def get(client, url, **kw):
    t0 = time.perf_counter()
    r = client.request(kw.pop("method", "GET"), url, **kw)
    ms = round((time.perf_counter() - t0) * 1000)
    try:
        body = r.json()
    except ValueError:
        body = None
    return r, ms, body


def catalog(client):
    for host in ["www.easicoin.io", "easicoin.io", "api.easicoin.io", "openapi.easicoin.io", "ws2.easicoin.io"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
            log("dns", host=host, addrs=addrs)
        except socket.gaierror as e:
            log("dns", host=host, error=str(e))

    # A fresh client measures DNS, TCP and TLS together.
    with httpx.Client(headers=HEADERS, timeout=30) as cold:
        r, ms, _ = get(cold, CATALOG)
        log("catalog_cold", status=r.status_code, ms=ms, bytes=len(r.content), cache_control=r.headers.get("cache-control"), server=r.headers.get("server"), cf_cache=r.headers.get("cf-cache-status"))

    times = []
    for _ in range(5):
        r, ms, body = get(client, CATALOG)
        times.append(ms)
        time.sleep(0.5)
    log("catalog_warm", ms=times, median=statistics.median(times), cf_cache=r.headers.get("cf-cache-status"))
    keep("dynamic_symbol.json", r.text)

    small = []
    for _ in range(5):
        small.append(get(client, f"{MAPI}/spot/public/v1/quote/market/tickers")[1])
        time.sleep(0.3)
    log("small_call_warm", path="/spot/public/v1/quote/market/tickers", ms=small)

    d = body["data"]
    log("catalog_keys", code=body.get("code"), keys={k: (len(v) if isinstance(v, (list, dict)) else v) for k, v in d.items()}, SupportedCoins=d.get("SupportedCoins"), OfflineSymbols=d.get("OfflineSymbols"))
    families = ["LinearPerpetual", "InversePerpetual", "InverseFutures", "FreeUPerpetual", "StockRwaPerpetual", "MetalRwaPerpetual", "BlockTradePerpetual"]
    for fam in families:
        rows = d.get(fam) or []
        log(
            "family",
            fam=fam,
            rows=len(rows),
            contractType=count(rows, lambda r: r.get("contractType")),
            contractStatus=count(rows, lambda r: r.get("contractStatus")),
            symbolStatus=count(rows, lambda r: r.get("symbolStatus")),
            symbolDisplay=count(rows, lambda r: r.get("symbolDisplay")),
            quote=count(rows, lambda r: r.get("quoteCurrency")),
            takerE8=count(rows, lambda r: r.get("defaultTakerFeeRateE8")),
            makerE8=count(rows, lambda r: r.get("defaultMakerFeeRateE8")),
            contractSize=count(rows, lambda r: r.get("contractSize")),
            category=count(rows, lambda r: r.get("symbolCategory")),
            examples=[r.get("symbolName") for r in rows[:6]],
        )

    lin = d["LinearPerpetual"]
    log("linear_fields", perRow=count(lin, lambda r: len(r)), keys=sorted(lin[0].keys()))
    log(
        "linear_names",
        nameEqualsAlias=sum(r["symbolName"] == r["symbolAlias"] for r in lin),
        nameEqualsBaseQuote=sum(r["symbolName"] == r["baseCurrency"] + r["quoteCurrency"] for r in lin),
        odd=[[r["symbolName"], r["symbolAlias"], r["baseCurrency"], r["quoteCurrency"]] for r in lin if r["symbolName"] != r["baseCurrency"] + r["quoteCurrency"]][:20],
    )
    bases = collections.Counter(r["baseCurrency"] for r in lin)
    log("linear_duplicates", basesListedTwice=[[b, n] for b, n in bases.items() if n > 1])
    single = [r for r in lin if len(r.get("indexSource") or []) == 1]
    log(
        "linear_index_sources",
        sourcesPerContract=count(lin, lambda r: len(r.get("indexSource") or [])),
        single=count(single, lambda r: r["indexSource"][0]),
        anyEasicoin=sum(any("easi" in s.lower() for s in (r.get("indexSource") or [])) for r in lin),
        examples=[[r["symbolName"], r.get("indexSource")] for r in lin if r["symbolName"] in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT")],
    )
    log(
        "linear_category_crosstab",
        rows=[[*k, n] for k, n in collections.Counter((r.get("symbolCategory"), r["indexSource"][0] if len(r.get("indexSource") or []) == 1 else "multi", r.get("defaultTakerFeeRateE8"), r.get("defaultMakerFeeRateE8")) for r in lin).most_common()],
        gold=[r["symbolName"] for r in lin if r.get("symbolCategory") == "gold"],
        stockExamples=[r["symbolName"] for r in lin if r.get("symbolCategory") == "stock"][:8],
        multiplierNames=[r["symbolName"] for r in lin if r["baseCurrency"][:1].isdigit() and r["baseCurrency"].startswith("1000")],
    )
    btc = next(r for r in lin if r["symbolName"] == "BTCUSDT")
    log("linear_limits", priceLimitPntE6=count(lin, lambda r: r.get("priceLimitPntE6")), btc={k: btc.get(k) for k in ("lotSize", "minQty", "tickSize", "contractSize", "maxLeverageE2", "startTradingTimeE3")}, tags=count(lin, lambda r: r.get("symbolTags")))
    for fam in ["FreeUPerpetual", "BlockTradePerpetual"]:
        log("other_family_rows", fam=fam, rows=[[r.get("symbolName"), r.get("quoteCurrency"), r.get("contractStatus"), r.get("defaultTakerFeeRateE8")] for r in d.get(fam) or []])

    spot, ms, sbody = get(client, f"{MAPI}/spot-openapi/public/v1/market/summary-new")
    rows = (sbody or {}).get("data") or []
    log("spot_summary", status=spot.status_code, ms=ms, bytes=len(spot.content), pairs=len(rows), quotes=count(rows, lambda r: r.get("quote_currency")))
    q, ms, qbody = get(client, f"{MAPI}/spot/public/v1/config/quote_tokens")
    toks = (qbody or {}).get("data") or []
    log("spot_quote_tokens", status=q.status_code, ms=ms, bytes=len(q.content), quotes={t.get("tokenId"): len(t.get("baseTokenSymbols") or []) for t in toks})
    btcspot = next((s for t in toks for s in t.get("baseTokenSymbols") or [] if s.get("symbolId") == "BTCUSDT"), None)
    if btcspot:
        log("spot_btc_row", keys=sorted(btcspot.keys()), fee={k: v for k, v in btcspot.items() if "fee" in k.lower() or "Fee" in k}, exchangeId=btcspot.get("exchangeId"), orgId=btcspot.get("orgId"))

    for path in ["/trade/public/v1/market/fee-rate", "/desk/vipfee/config", "/trade/public/v1/market/plates"]:
        r, ms, b = get(client, f"{MAPI}{path}")
        log("extra", path=path, status=r.status_code, ms=ms, bytes=len(r.content), body=r.text[:300])
        time.sleep(0.3)


def access(client):
    urls = [
        f"{WWW}/",
        f"{WWW}/en-US",
        "https://easicoin.io/",
        "https://www.easicoin.com/",
        "https://docs.easicoin.io/english",
        "https://api.easicoin.io/",
        "https://api.easicoin.io/mapi/trade/public/v1/market/dynamic_symbol",
        "https://api.easicoin.io/v5/market/time",
        "https://api.easicoin.io/api/v1/time",
        "https://openapi.easicoin.io/",
        f"{WWW}/api",
        f"{WWW}/docs",
        f"{WWW}/en-US/api",
        f"{WWW}/en-US/apiManagement",
    ]
    for url in urls:
        try:
            r, ms, _ = get(client, url, follow_redirects=False)
            log("status", url=url, status=r.status_code, ms=ms, bytes=len(r.content), server=r.headers.get("server"), location=r.headers.get("location"), head=r.text[:120] if r.status_code >= 300 or len(r.content) < 200 else None)
        except httpx.HTTPError as e:
            log("status", url=url, error=f"{type(e).__name__} {e}")
        time.sleep(0.3)
    for path in ["/user/public/v3/country-code", "/user/public/v1/country-code", "/commom-public/google-play/public/v1/unavailable-regions"]:
        r, ms, b = get(client, f"{MAPI}{path}")
        log("region", path=path, status=r.status_code, body=r.text[:300])
        time.sleep(0.3)
    r, ms, b = get(client, f"{MAPI}/user/public/v1/ban-area/check", method="POST", json={})
    log("ban_area", status=r.status_code, body=r.text[:400])


def anchor(client):
    now = int(time.time())
    for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT"]:
        r, ms, b = get(client, f"{MAPI}/trade/public/v1/market/funding-rate-history", params={"symbol": sym, "from": now - 3 * 86400, "to": now, "timeStamp": int(time.time() * 1000)})
        lst = ((b or {}).get("data") or {}).get("list") or []
        gaps = [(int(lst[i]["time"]) - int(lst[i + 1]["time"])) / 3600 for i in range(len(lst) - 1)] if lst and "time" in lst[0] else []
        log(
            "funding_history",
            sym=sym,
            status=r.status_code,
            ms=ms,
            rows=len(lst),
            body=None if lst else r.text[:300],
            newest=[datetime.fromtimestamp(int(lst[0]["time"]), timezone.utc).isoformat(), lst[0].get("valueE8")] if lst and "time" in lst[0] else (lst[:1] or None),
            intervalsHours=dict(collections.Counter(gaps)),
            settleHoursUtc=dict(collections.Counter(datetime.fromtimestamp(int(x["time"]), timezone.utc).hour for x in lst if "time" in x)),
            valuesE8=dict(collections.Counter(x.get("valueE8") for x in lst).most_common(6)),
        )
        time.sleep(0.3)
    r, ms, b = get(client, f"{MAPI}/trade/public/v1/market/mark-price-list", params={"symbol": "BTCUSDT", "resolution": 1, "from": now - 180, "to": now})
    lst = ((b or {}).get("data") or {}).get("list") or []
    log("mark_price_list", status=r.status_code, ms=ms, bytes=len(r.content), rows=len(lst), last=lst[-1] if lst else r.text[:200])
    r, ms, b = get(client, f"{MAPI}/trade/public/v1/market/funding-rate-history", params={"from": now - 86400, "to": now})
    log("funding_history_without_symbol", status=r.status_code, body=r.text[:200])
    r, ms, b = get(client, f"{MAPI}/trade/public/v1/market/risk-pool-list", params={"symbol": "BTCUSDT"})
    log("risk_pool_list", status=r.status_code, body=r.text[:200])
    for path in ["/trade/public/v1/market/tickers", "/trade/public/v1/market/ticker", "/trade/public/v1/market/instruments", "/trade/public/v1/market/funding-rate", "/trade/public/v1/market/premium-index", "/trade/public/v1/market/orderbook", "/trade/public/v1/market/depth"]:
        r, ms, b = get(client, f"{MAPI}{path}")
        log("bulk_guess", path=path, status=r.status_code, body=r.text[:160])
        time.sleep(0.3)


def book(client):
    tries = [
        ("/trade/public/v1/market/orderbook", {"symbol": "BTCUSDT"}),
        ("/trade/public/v1/market/depth", {"symbol": "BTCUSDT"}),
        ("/trade/public/v1/market/orderBook/L2", {"symbol": "BTCUSDT"}),
        ("/spot/public/v1/quote/depth", {"symbol": "301.BTCUSDT"}),
        ("/spot/public/v1/quote/depth", {"symbol": "BTCUSDT"}),
        ("/spot-openapi/public/v1/market/orderbook", {"market_pair": "BTC_USDT"}),
        ("/spot-openapi/public/v1/market/orderbook", {"symbol": "BTCUSDT"}),
    ]
    for path, params in tries:
        r, ms, b = get(client, f"{MAPI}{path}", params=params)
        log("book_guess", path=path, params=params, status=r.status_code, ms=ms, body=r.text[:240])
        time.sleep(0.3)


def server_time(client):
    rows = []
    for _ in range(10):
        t0 = time.time() * 1000
        r, ms, b = get(client, f"{MAPI}/spot/public/v1/quote/market/tickers")
        t1 = time.time() * 1000
        rows.append({"rtt": round(t1 - t0), "offset": (b or {}).get("time", 0) - (t0 + t1) / 2, "date": r.headers.get("date")})
        time.sleep(0.3)
    log("time", rtt=[x["rtt"] for x in rows], offsetMs=[round(x["offset"]) for x in rows], medianOffsetMs=round(statistics.median(x["offset"] for x in rows)), date=rows[0]["date"])
    for url in [CATALOG, f"{MAPI}/spot/public/v1/quote/market/tickers"]:
        r, ms, b = get(client, url)
        names = sorted(r.headers.keys())
        log("headers", url=url, names=names, rateLimitLike=[k for k in names if any(s in k for s in ("limit", "retry", "quota", "remain"))])


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "catalog"
    run = {"catalog": catalog, "access": access, "anchor": anchor, "book": book, "time": server_time}.get(mode)
    if not run:
        sys.exit(f"unknown mode {mode}")
    log("start", mode=mode, at=datetime.now(timezone.utc).isoformat())
    with httpx.Client(headers=HEADERS, timeout=30) as client:
        run(client)
    log("end", mode=mode, at=datetime.now(timezone.utc).isoformat())


if __name__ == "__main__":
    main()
