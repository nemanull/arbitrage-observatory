# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Coinmate, public market data only.

Modes, all by default, or name some on the command line:
    host     the exit's geolocation from ipinfo.io, DNS, cold and warm request time, edge headers
    catalog  /tradingPairs and /products, with counts, status values, quote currencies and the fields on the wire
    book     /orderBook for BTC_EUR with groupByPriceLimit False and True, and for USDC_CZK, depth, level order, crossed check
    ticker   /ticker for BTC_EUR and /tickerAll, with pair count, keys and timestamp unit
    trades   /transactions for BTC_EUR over 60 minutes
    anchor   paths a perpetual venue would serve for index, mark or funding, to confirm they are absent
    poll     /orderBook BTC_EUR for 60 s, one call about every 1.2 s, counting how often the top of book changes
    errors   an unknown pair, a missing pair, lower case, a private call without a key
    limits   the response headers of 5 calls 1 s apart, looking for any rate limit header
    time     /system/time against the local clock

Every call is unauthenticated.
The published limit is 100 requests per minute per IP, and the probe waits at least 1 s between calls,
so the whole run makes about 70 requests over about 2.5 minutes.

Run from the repository root:
    uv run scripts/probes/venues/coinmate/rest-probe.py [mode ...]
"""

import json
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request

API = "https://coinmate.io/api"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
GAP_S = 1.0
_last = [0.0]


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(url: str, method: str = "GET", data: bytes | None = None) -> tuple[int, dict, bytes, float]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=UA, method=method, data=data)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, hdrs, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, dict(e.headers), e.read()
    ms = round((time.perf_counter() - t0) * 1000, 1)
    _last[0] = time.monotonic()
    return status, {k.lower(): v for k, v in hdrs.items()}, body, ms


def jbody(body: bytes):
    try:
        return json.loads(body)
    except ValueError:
        return None


def trim(b: bytes, n: int = 300) -> str:
    s = b.decode("utf-8", "replace")
    return s if len(s) <= n else s[:n] + f"...(+{len(s) - n} chars)"


def host() -> None:
    st, h, b, ms = get("https://ipinfo.io/json")
    geo = jbody(b) or {}
    out(mode="host", exit={k: geo.get(k) for k in ["city", "region", "country", "org"]})
    t0 = time.perf_counter()
    addrs = sorted({a[4][0] for a in socket.getaddrinfo("coinmate.io", 443)})
    out(mode="host", dns_ms=round((time.perf_counter() - t0) * 1000, 1), addresses=addrs)
    ctx = ssl.create_default_context()
    t0 = time.perf_counter()
    with socket.create_connection(("coinmate.io", 443), timeout=10) as s:
        with ctx.wrap_socket(s, server_hostname="coinmate.io") as ss:
            out(mode="host", tcp_tls_ms=round((time.perf_counter() - t0) * 1000, 1), tls=ss.version(),
                peer=ss.getpeername()[0])
    times = []
    for i in range(4):
        st, h, b, ms = get(f"{API}/system/time")
        times.append(ms)
        if i == 0:
            out(mode="host", call="/system/time", status=st, server=h.get("server"), cf_ray=h.get("cf-ray"),
                cache=h.get("cf-cache-status"), body=trim(b))
    out(mode="host", request_ms=times, note="urllib opens a new connection per call, so each includes TLS")


def catalog() -> None:
    st, h, b, ms = get(f"{API}/tradingPairs")
    d = jbody(b)
    pairs = d["data"]
    out(mode="catalog", call="/tradingPairs", status=st, ms=ms, bytes=len(b), count=len(pairs),
        keys=sorted(pairs[0]), names=[p["name"] for p in pairs],
        quotes=sorted({p["secondCurrency"] for p in pairs}),
        ws_channel_ids=sorted({str(p.get("orderBookWebSocketChannelId")) for p in pairs}))
    out(mode="catalog", first=pairs[0])
    st, h, b, ms = get(f"{API}/products")
    d = jbody(b)
    prods = d["data"]
    out(mode="catalog", call="/products", status=st, ms=ms, count=len(prods), keys=sorted(prods[0]),
        statuses=sorted({p.get("status") for p in prods}), ids=[p["id"] for p in prods])
    names = {p["name"] for p in pairs}
    ids = {p["id"].replace("-", "_") for p in prods}
    out(mode="catalog", same_set=names == ids, only_in_tradingPairs=sorted(names - ids), only_in_products=sorted(ids - names))


def book_summary(data: dict) -> dict:
    bids, asks = data.get("bids") or [], data.get("asks") or []
    bp = [float(x["price"]) for x in bids]
    ap = [float(x["price"]) for x in asks]
    return {"keys": sorted(data), "level_keys": sorted(bids[0]) if bids else None, "bids": len(bids), "asks": len(asks),
            "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
            "crossed": bool(bp and ap and bp[0] >= ap[0]), "duplicate_prices": len(bp) - len(set(bp)) + len(ap) - len(set(ap)),
            "best": [bp[0] if bp else None, ap[0] if ap else None],
            "timestamp": data.get("timestamp"), "status": data.get("status")}


def book() -> None:
    for pair, group in [("BTC_EUR", "False"), ("BTC_EUR", "True"), ("USDC_CZK", "False")]:
        st, h, b, ms = get(f"{API}/orderBook?currencyPair={pair}&groupByPriceLimit={group}")
        d = jbody(b)
        out(mode="book", pair=pair, groupByPriceLimit=group, status=st, ms=ms, bytes=len(b), local_ms=int(time.time() * 1000),
            cache=h.get("cf-cache-status"), cache_control=h.get("cache-control"), top_keys=sorted(d),
            summary=book_summary(d["data"]) if d and d.get("data") else d)
        if pair == "BTC_EUR" and group == "True" and d and d.get("data"):
            bk = d["data"]
            out(mode="book", excerpt={"asks": bk["asks"][:2], "bids": bk["bids"][:2],
                                      "timestamp": bk["timestamp"], "status": bk["status"]})
    st, h, b, ms = get(f"{API}/orderBook?currencyPair=BTC_EUR")
    out(mode="book", pair="BTC_EUR", groupByPriceLimit="omitted", status=st, body=trim(b, 200))


def ticker() -> None:
    st, h, b, ms = get(f"{API}/ticker?currencyPair=BTC_EUR")
    d = jbody(b)
    out(mode="ticker", call="/ticker BTC_EUR", status=st, ms=ms, data=d.get("data"), local_unix_s=int(time.time()))
    st, h, b, ms = get(f"{API}/tickerAll")
    d = jbody(b)
    data = d["data"]
    out(mode="ticker", call="/tickerAll", status=st, ms=ms, bytes=len(b), pairs=len(data), names=sorted(data),
        keys=sorted(next(iter(data.values()))))


def trades() -> None:
    st, h, b, ms = get(f"{API}/transactions?currencyPair=BTC_EUR&minutesIntoHistory=60")
    d = jbody(b)
    rows = d.get("data") or []
    out(mode="trades", status=st, ms=ms, count=len(rows), keys=sorted(rows[0]) if rows else None,
        first=rows[0] if rows else None)


def anchor() -> None:
    for path in ["markPrice?currencyPair=BTC_EUR", "indexPrice?currencyPair=BTC_EUR", "fundingRate?currencyPair=BTC_EUR",
                 "futures/tradingPairs", "perpetual/tradingPairs"]:
        st, h, b, ms = get(f"{API}/{path}")
        out(mode="anchor", path=f"/api/{path}", status=st, content_type=h.get("content-type"), body=trim(b, 200))


def poll() -> None:
    tops = []
    t0 = time.monotonic()
    times = []
    while time.monotonic() - t0 < 60:
        st, h, b, ms = get(f"{API}/orderBook?currencyPair=BTC_EUR&groupByPriceLimit=False")
        times.append(ms)
        d = jbody(b)
        if st != 200 or not d or not d.get("data"):
            out(mode="poll", status=st, body=trim(b, 200))
            continue
        bk = d["data"]
        tops.append((bk["bids"][0]["price"], bk["bids"][0]["amount"], bk["asks"][0]["price"], bk["asks"][0]["amount"]))
        time.sleep(1.0)
    changes = sum(1 for a, c in zip(tops, tops[1:]) if a != c)
    out(mode="poll", calls=len(tops), top_changes=changes, distinct_tops=len(set(tops)),
        ms_median=statistics.median(times), ms_max=max(times))


def errors() -> None:
    cases = [
        ("unknown pair", "GET", f"{API}/orderBook?currencyPair=FOO_BAR&groupByPriceLimit=False", None),
        ("missing pair", "GET", f"{API}/orderBook", None),
        ("lower case", "GET", f"{API}/orderBook?currencyPair=btc_eur&groupByPriceLimit=False", None),
        ("unknown ticker", "GET", f"{API}/ticker?currencyPair=FOO_BAR", None),
        ("private no key", "POST", f"{API}/traderFees", b"currencyPair=BTC_EUR"),
        ("unknown path", "GET", f"{API}/doesNotExist", None),
    ]
    for label, method, url, data in cases:
        st, h, b, ms = get(url, method, data)
        out(mode="errors", case=label, status=st, content_type=h.get("content-type"), body=trim(b, 250))


def limits() -> None:
    for i in range(5):
        st, h, b, ms = get(f"{API}/ticker?currencyPair=BTC_EUR")
        rl = {k: v for k, v in h.items() if "limit" in k.lower() or "retry" in k.lower() or "remaining" in k.lower()}
        out(mode="limits", i=i, status=st, rate_headers=rl, header_names=sorted(h) if i == 0 else None)


def clock() -> None:
    offs = []
    for _ in range(3):
        t_send = time.time()
        st, h, b, ms = get(f"{API}/system/time")
        t_recv = time.time()
        server = jbody(b)["serverTime"]
        offs.append(round(server - (t_send + t_recv) / 2 * 1000, 1))
    out(mode="time", offsets_ms=offs, rtt_ms_last=ms, note="server minus local midpoint")


if __name__ == "__main__":
    table = {"host": host, "catalog": catalog, "book": book, "ticker": ticker, "trades": trades, "anchor": anchor,
             "poll": poll, "errors": errors, "limits": limits, "time": clock}
    for m in sys.argv[1:] or list(table):
        out(mode=m, event="start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        table[m]()
