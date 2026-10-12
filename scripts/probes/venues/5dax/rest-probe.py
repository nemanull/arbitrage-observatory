# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for 5DAX, public spot market data only.

5DAX publishes a Binance style public API at https://api.5dax.com/api/v1, documented on https://5dax.com/api.html.
The web app also reads market data from undocumented paths on https://5dax.com itself,
such as /exchange/getProducts and /exchange/depth, and this probe reads both.
The document asks for no more than 6 calls per second.
The hosts answer X-RateLimit-Limit 50 and 10, so this probe waits at least 1.3 s between calls.

Modes, all by default, or name some on the command line:
    host     DNS for the three hosts, cold and warm request time, server time and clock offset
    catalog  exchangeInfo, getProducts and the 24 h ticker, counts by status and quote asset,
             and the perpetual paths a Binance clone would expose
    book     the REST book on both hosts, depth limits, level order, value types, update ids,
             the book ticker against the book, and unknown or odd symbols
    limits   the rate limit headers over ten spaced calls, and error shapes

Run from the repository root:
    uv run scripts/probes/venues/5dax/rest-probe.py [mode ...]
"""

import http.client
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter

API = "https://api.5dax.com/api/v1"
SITE = "https://5dax.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
GAP_S = 1.3  # the API host answered X-RateLimit-Limit 50, so stay under 50 calls a minute
_last = [0.0]


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str):
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode(errors="replace")
            status, headers = r.status, r.headers
    except urllib.error.HTTPError as e:
        body = e.read().decode(errors="replace")
        status, headers = e.code, e.headers
    ms = round((time.perf_counter() - t0) * 1000)
    _last[0] = time.monotonic()
    return status, headers, body, ms


def js(body: str):
    try:
        return json.loads(body)
    except ValueError:
        return None


def host_mode() -> None:
    for h in ("api.5dax.com", "5dax.com", "socket.5dax.com"):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        out(mode="host", host=h, addresses=addrs)
    cold = []
    for _ in range(3):
        status, headers, body, ms = get(API + "/time")
        cold.append(ms)
    out(mode="host", what="cold, new TLS connection per call", url=API + "/time", ms=cold,
        server=headers.get("Server"), cf_ray=headers.get("CF-RAY"), x_powered_by=headers.get("X-Powered-By"))
    conn = http.client.HTTPSConnection("api.5dax.com", timeout=20)
    warm = []
    offsets = []
    for i in range(6):
        time.sleep(GAP_S)
        t0 = time.time()
        p0 = time.perf_counter()
        conn.request("GET", "/api/v1/time", headers={"User-Agent": UA})
        r = conn.getresponse()
        body = r.read().decode()
        ms = (time.perf_counter() - p0) * 1000
        t1 = time.time()
        if i:
            warm.append(round(ms))
        st = js(body).get("serverTime")
        offsets.append(round(st - (t0 + t1) * 500))
    conn.close()
    out(mode="host", what="warm, one kept alive connection, first call dropped", ms=warm,
        median_ms=statistics.median(warm))
    out(mode="host", what="server minus local midpoint, ms", offsets=offsets, median=statistics.median(offsets))
    status, _, body, ms = get(API + "/ping")
    out(mode="host", url=API + "/ping", status=status, body=body[:100], ms=ms)


def catalog_mode() -> None:
    status, headers, body, ms = get(API + "/exchangeInfo")
    e = js(body)
    syms = e["symbols"]
    out(mode="catalog", url=API + "/exchangeInfo", status=status, ms=ms, bytes=len(body), keys=list(e),
        rateLimits=e.get("rateLimits"), count=len(syms),
        status_counts=dict(Counter(s["status"] for s in syms)),
        quote_counts=dict(Counter(s["quoteAsset"] for s in syms)),
        symbol_keys=sorted(syms[0]), filter_types=sorted({f["filterType"] for s in syms for f in s["filters"]}),
        first=syms[0])
    ids = [s["symbol"] for s in syms]
    out(mode="catalog", duplicates=[k for k, v in Counter(ids).items() if v > 1],
        pairs_twice=[k for k, v in Counter((s["baseAsset"], s["quoteAsset"]) for s in syms).items() if v > 1],
        not_base_plus_quote=[s["symbol"] for s in syms if s["symbol"] != s["baseAsset"] + s["quoteAsset"]])
    status, _, body, ms = get(SITE + "/exchange/getProducts")
    p = js(body)["data"]
    out(mode="catalog", url=SITE + "/exchange/getProducts", status=status, ms=ms, bytes=len(body), count=len(p),
        keys=sorted(p[0]), active=dict(Counter(x["active"] for x in p)), status_counts=dict(Counter(x["status"] for x in p)),
        productType=dict(Counter(str(x["productType"]) for x in p)),
        matchingUnitType=dict(Counter(x["matchingUnitType"] for x in p)),
        only_in_products=sorted({x["symbol"] for x in p} - set(ids)),
        only_in_exchangeInfo=sorted(set(ids) - {x["symbol"] for x in p}))
    status, _, body, ms = get(API + "/ticker/24hr")
    t = js(body)
    vols = sorted(((float(x.get("quoteVolume") or 0), x["symbol"]) for x in t), reverse=True)
    usdt = sum(v for v, s in vols if s.endswith("USDT"))
    crossed = [x["symbol"] for x in t if x.get("bidPrice") and x.get("askPrice") and float(x["bidPrice"]) > float(x["askPrice"])]
    out(mode="catalog", url=API + "/ticker/24hr", status=status, ms=ms, bytes=len(body), count=len(t),
        keys=sorted(t[0]), top10_quoteVolume=[[s, round(v, 2)] for v, s in vols[:10]],
        usdt_pairs_quoteVolume_sum=round(usdt, 2), crossed_bid_over_ask=crossed, crossed_count=len(crossed),
        btcusdt=[x for x in t if x["symbol"] == "BTCUSDT"])
    for path in ("/fapi/v1/exchangeInfo", "/fapi/v1/premiumIndex", "/api/v1/premiumIndex",
                 "/api/v1/fundingRate", "/dapi/v1/exchangeInfo"):
        for base in ("https://api.5dax.com", SITE):
            status, headers, body, ms = get(base + path)
            out(mode="catalog", probe="perpetual path", url=base + path, status=status,
                content_type=headers.get("Content-Type"), body=body[:80])


def levels_info(side: list, desc: bool) -> dict:
    prices = [float(x[0]) for x in side]
    return {"n": len(side), "sorted_best_first": prices == sorted(prices, reverse=desc),
            "types": sorted({json.dumps([type(v).__name__ for v in x]) for x in side}),
            "zero_sizes": sum(1 for x in side if float(x[1]) == 0)}


def book_mode() -> None:
    for limit in (None, 5, 20, 100, 1000, 7, 0, 5000):
        url = API + "/depth?symbol=BTCUSDT" + (f"&limit={limit}" if limit is not None else "")
        status, headers, body, ms = get(url)
        d = js(body)
        if isinstance(d, dict) and "bids" in d:
            luid = d.get("lastUpdateId")
            id_second = int(luid[:8], 16) if isinstance(luid, str) and len(luid) == 24 else None
            out(mode="book", url=url, status=status, ms=ms, bytes=len(body), lastUpdateId=luid,
                id_first8hex_as_unix_s_minus_now=round(id_second - time.time(), 1) if id_second else None,
                body=body if limit == 5 else None,
                bids=levels_info(d["bids"], True), asks=levels_info(d["asks"], False),
                best=[d["bids"][0] if d["bids"] else None, d["asks"][0] if d["asks"] else None],
                etag=headers.get("ETag"), cache_control=headers.get("Cache-Control"), cf_cache=headers.get("CF-Cache-Status"))
        else:
            out(mode="book", url=url, status=status, ms=ms, body=body[:200])
    for limit in (None, 100, 1000):
        url = SITE + "/exchange/depth?symbol=BTCUSDT" + (f"&limit={limit}" if limit is not None else "")
        status, headers, body, ms = get(url)
        d = js(body)
        if isinstance(d, dict) and "bids" in d:
            out(mode="book", url=url, status=status, ms=ms, bytes=len(body), lastUpdateId=d.get("lastUpdateId"),
                keys=sorted(d), bids=levels_info(d["bids"], True), asks=levels_info(d["asks"], False),
                best=[d["bids"][0] if d["bids"] else None, d["asks"][0] if d["asks"] else None])
        else:
            out(mode="book", url=url, status=status, ms=ms, body=body[:200])
    for sym in ("BTCUSDT", "ETHUSDT", "ETHBTC"):
        _, _, b1, _ = get(API + f"/ticker/bookTicker?symbol={sym}")
        _, _, b2, _ = get(API + f"/depth?symbol={sym}&limit=5")
        bt, dp = js(b1), js(b2)
        out(mode="book", symbol=sym, bookTicker=bt,
            depth_best=[dp["bids"][0] if dp.get("bids") else None, dp["asks"][0] if dp.get("asks") else None])
    status, _, body, ms = get(API + "/ticker/bookTicker")
    bt = js(body)
    if isinstance(bt, list):
        locked = sum(1 for x in bt if x["bidPrice"] == x["askPrice"])
        crossed = sum(1 for x in bt if float(x["bidPrice"]) > float(x["askPrice"]))
        out(mode="book", url=API + "/ticker/bookTicker", status=status, ms=ms, count=len(bt),
            bid_equals_ask=locked, bid_over_ask=crossed, sample=bt[:2])
    else:
        out(mode="book", url=API + "/ticker/bookTicker", status=status, body=body[:200])
    for url in (API + "/order_book?symbol=BTCUSDT", API + "/returnTicker?symbol=BTCUSDT",
                API + "/depth?symbol=NOPEUSDT", API + "/depth?symbol=btcusdt&limit=5",
                API + "/depth?symbol=BTC_USDT&limit=5", API + "/depth",
                SITE + "/exchange/depth?symbol=NOPEUSDT", SITE + "/exchange/depth?symbol=btcusdt&limit=5"):
        status, headers, body, ms = get(url)
        out(mode="book", url=url, status=status, ms=ms, bytes=len(body), body=body[:220])


def limits_mode() -> None:
    rows = []
    for i in range(10):
        status, headers, body, ms = get(API + "/depth?symbol=BTCUSDT&limit=5")
        reset = headers.get("X-RateLimit-Reset")
        rows.append([round(time.time(), 1), status, headers.get("X-RateLimit-Limit"),
                     headers.get("X-RateLimit-Remaining"), reset,
                     round(int(reset) - time.time(), 1) if reset else None, headers.get("Retry-After")])
    out(mode="limits", url=API + "/depth?symbol=BTCUSDT&limit=5", spacing_s=GAP_S,
        rows_time_status_limit_remaining_reset_resetinS_retryafter=rows)
    for url in (API + "/time", API + "/exchangeInfo", SITE + "/exchange/getProducts", SITE + "/exchange/depth?symbol=BTCUSDT"):
        status, headers, body, ms = get(url)
        reset = headers.get("X-RateLimit-Reset")
        out(mode="limits", url=url, status=status, reset_in_s=round(int(reset) - time.time(), 1) if reset else None,
            ratelimit={k: v for k, v in headers.items() if "ratelimit" in k.lower() or k.lower() == "retry-after"})
    for url in (API + "/nope", API + "/klines?symbol=BTCUSDT", API + "/klines?symbol=BTCUSDT&interval=9x",
                API + "/trades?symbol=BTCUSDT&limit=2"):
        status, headers, body, ms = get(url)
        out(mode="limits", probe="error shape", url=url, status=status, body=body[:220])


def main() -> None:
    modes = sys.argv[1:] or ["host", "catalog", "book", "limits"]
    out(probe="5dax rest", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=modes)
    for m in modes:
        {"host": host_mode, "catalog": catalog_mode, "book": book_mode, "limits": limits_mode}[m]()
    out(probe="5dax rest", finished=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
