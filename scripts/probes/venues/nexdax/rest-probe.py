# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""NexDAX spot REST probe for docs/profiles/nexdax/rest.md.

Public, unauthenticated and read-only.
It sends about 35 requests to api.nexdax.com, below the 50 per window that the x-ratelimit-limit header announces, and stops early when x-ratelimit-remaining falls under 5.
Run from the repository root with: uv run scripts/probes/venues/nexdax/rest-probe.py
"""

import collections
import json
import socket
import statistics
import time
import urllib.error
import urllib.request

API = "https://api.nexdax.com"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}
remaining = [50]


def get(url):
    """Return status, headers, body text and elapsed ms, without raising on HTTP errors."""
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        status, headers = e.code, dict(e.headers)
    ms = (time.perf_counter() - t0) * 1000
    if url.startswith(API) and "x-ratelimit-remaining" in {k.lower() for k in headers}:
        remaining[0] = int({k.lower(): v for k, v in headers.items()}["x-ratelimit-remaining"])
    return status, headers, body, ms


def api(path):
    if remaining[0] < 5:
        raise SystemExit(f"stopping: x-ratelimit-remaining {remaining[0]}")
    return get(API + path)


def section(title):
    print(f"\n== {title}")


def main():
    section("1. host and latency")
    infos = socket.getaddrinfo("api.nexdax.com", 443, proto=socket.IPPROTO_TCP)
    print("resolved", sorted({i[4][0] for i in infos}))
    times, offsets = [], []
    for i in range(6):
        t_send = time.time() * 1000
        st, h, body, ms = api("/api/v1/time")
        t_recv = time.time() * 1000
        server = json.loads(body)["serverTime"]
        offsets.append(server - (t_send + t_recv) / 2)
        times.append(ms)
        if i == 0:
            print("time status", st, "body", body)
            hl = {k.lower(): v for k, v in h.items()}
            print("headers server", hl.get("server"), "cf-ray", hl.get("cf-ray"), "x-powered-by", hl.get("x-powered-by"))
            print("x-ratelimit headers on /api/v1/time", {k: v for k, v in hl.items() if k.startswith("x-ratelimit")})
    print("cold ms", round(times[0]), "warm ms median", round(statistics.median(times[1:])), "min", round(min(times[1:])), "max", round(max(times[1:])))
    print("clock offset ms, server minus local midpoint, median", round(statistics.median(offsets)), "range", round(min(offsets)), round(max(offsets)))
    st, h, body, ms = api("/api/v1/ping")
    print("ping", st, body)

    section("2. catalog")
    st, h, body, ms = api("/api/v1/exchangeInfo")
    info = json.loads(body)
    syms = info["symbols"]
    print("exchangeInfo status", st, "bytes", len(body), "ms", round(ms))
    hl = {k.lower(): v for k, v in h.items()}
    rl = {k: v for k, v in hl.items() if k.startswith("x-ratelimit")}
    print("x-ratelimit headers on exchangeInfo", rl, "reset minus serverTime s", int(rl.get("x-ratelimit-reset", 0)) - info["serverTime"] // 1000)
    print("rateLimits", json.dumps(info["rateLimits"]))
    print("symbols", len(syms), "status", dict(collections.Counter(s["status"] for s in syms)))
    print("quote assets", dict(collections.Counter(s["quoteAsset"] for s in syms).most_common()))
    print("keys", sorted({k for s in syms for k in s}))
    print("filter types", dict(collections.Counter(f["filterType"] for s in syms for f in s["filters"])))
    print("BTCUSDT row", json.dumps(next(s for s in syms if s["symbol"] == "BTCUSDT")))
    names = [s["symbol"] for s in syms]
    dup = [n for n, c in collections.Counter(names).items() if c > 1]
    print("duplicate symbols", dup)
    pairs = collections.Counter((s["baseAsset"], s["quoteAsset"]) for s in syms)
    print("pairs listed twice", [p for p, c in pairs.items() if c > 1])
    concat_bad = [s["symbol"] for s in syms if s["symbol"] != s["baseAsset"] + s["quoteAsset"]]
    print("symbol differs from base+quote", len(concat_bad), concat_bad[:10])

    st, h, body, ms = api("/api/v1/ticker/bookTicker")
    bt = json.loads(body)
    two = [x for x in bt if float(x["bidPrice"] or 0) > 0 and float(x["askPrice"] or 0) > 0]
    crossed = [x["symbol"] for x in two if float(x["bidPrice"]) >= float(x["askPrice"])]
    print("bookTicker status", st, "rows", len(bt), "bytes", len(body), "ms", round(ms), "two-sided", len(two), "crossed", len(crossed))
    print("bookTicker sample", json.dumps(bt[0]), "value types", {type(v).__name__ for v in bt[0].values()})
    one = [x["symbol"] for x in bt if (float(x["bidPrice"] or 0) > 0) != (float(x["askPrice"] or 0) > 0)]
    print("bookTicker one-sided", len(one), one[:8], "crossed", crossed)
    bt_set = {x["symbol"] for x in bt}
    print("catalog symbols missing from bookTicker", len(set(names) - bt_set), "extra", sorted(bt_set - set(names))[:10])

    st, h, body, ms = api("/api/v1/ticker/24hr")
    t24 = json.loads(body)
    print("ticker/24hr status", st, "rows", len(t24), "bytes", len(body), "ms", round(ms))
    btc = next(x for x in t24 if x["symbol"] == "BTCUSDT")
    print("ticker/24hr BTCUSDT", json.dumps(btc))
    bad = [x["symbol"] for x in t24 if float(x.get("bidPrice") or 0) > float(x.get("askPrice") or 0) > 0]
    print("ticker/24hr rows with bidPrice above askPrice", len(bad))
    zero_qty = sum(1 for x in t24 if not x.get("bidQty") and not x.get("askQty"))
    print("ticker/24hr rows with bidQty and askQty both 0", zero_qty)
    print("ticker/24hr rows with quoteVolume above 0", sum(1 for x in t24 if float(x.get("quoteVolume") or 0) > 0))
    print("ticker/24hr symbols not in catalog", sorted({x["symbol"] for x in t24} - set(names)))

    section("2b. CoinMarketCap pairs")
    for cat in ("spot", "perpetual", "futures"):
        st, h, body, ms = get(f"{CMC}/market-pairs/latest?slug=nexdax&category={cat}&start=1&limit=200")
        d = json.loads(body)["data"]
        print("CMC", cat, "numMarketPairs", d.get("numMarketPairs"), "rows", len(d.get("marketPairs", [])))
    st, h, body, ms = get(f"{CMC}/detail?slug=nexdax")
    q = json.loads(body)["data"]["quote"]["1"] if "1" in json.loads(body)["data"]["quote"] else {}
    print("CMC detail quote", json.dumps({k: q.get(k) for k in ("spotVolume24h", "perpetualVolume24h", "futuresVolume24h")}))

    section("3. derivatives and anchor paths")
    for p in ("/fapi/v1/ping", "/fapi/v1/exchangeInfo", "/fapi/v1/premiumIndex", "/api/v1/premiumIndex", "/dapi/v1/ping"):
        st, h, body, ms = api(p)
        print(p, st, body[:80])

    section("5. REST book")
    for lim in (None, 5, 100, 500, 1000):
        q = "" if lim is None else f"&limit={lim}"
        st, h, body, ms = api(f"/api/v1/depth?symbol=BTCUSDT{q}")
        d = json.loads(body)
        b, a = d.get("bids", []), d.get("asks", [])
        bids_desc = all(float(b[i][0]) > float(b[i + 1][0]) for i in range(len(b) - 1))
        asks_asc = all(float(a[i][0]) < float(a[i + 1][0]) for i in range(len(a) - 1))
        hl = {k.lower(): v for k, v in h.items()}
        print(f"limit={lim}", st, "bids", len(b), "asks", len(a), "bytes", len(body), "ms", round(ms),
              "bids desc", bids_desc, "asks asc", asks_asc, "keys", sorted(d), "cache-control", hl.get("cache-control"), "cf-cache-status", hl.get("cf-cache-status"))
        if st != 200:
            print("  error body", body[:200])
        if lim == 5:
            print("  x-ratelimit headers on depth", {k: v for k, v in hl.items() if k.startswith("x-ratelimit")})
            print("  depth limit=5 body", body[:400])
            print("  lastUpdateId type", type(d["lastUpdateId"]).__name__, "level types", type(b[0][0]).__name__)
    st, h, body, ms = api("/api/v1/depth?symbol=HOMEUSDT&limit=5")
    print("quiet pair HOMEUSDT", st, body[:300])

    ids, tops = [], []
    for i in range(10):
        st, h, body, ms = api("/api/v1/depth?symbol=BTCUSDT&limit=5")
        d = json.loads(body)
        if i == 0:
            oid = d["lastUpdateId"]
            print("lastUpdateId first 8 hex digits as unix seconds", int(oid[:8], 16), "local unix seconds", int(time.time()))
        ids.append(d["lastUpdateId"])
        tops.append((d["bids"][0][0], d["asks"][0][0]) if d["bids"] and d["asks"] else None)
        time.sleep(1)
    print("10 polls 1 s apart: distinct lastUpdateId", len(set(ids)), "distinct top of book", len(set(tops)))
    print("lastUpdateId sequence", ids)
    srt = sorted(ids)
    print("lastUpdateId sorted as hex strings equals poll order", srt == ids)
    back = sum(1 for a, b in zip(ids, ids[1:]) if b < a)
    same = sum(1 for a, b in zip(ids, ids[1:]) if b == a)
    print("lastUpdateId went backwards", back, "times and repeated", same, "times in 9 steps")
    print("lastUpdateId middle segments, hex digits 9 to 18", sorted({i[8:18] for i in ids}))
    for sym in crossed[:2]:
        st, h, body, ms = api(f"/api/v1/depth?symbol={sym}&limit=5")
        print("depth of bookTicker-crossed", sym, st, body[:260])

    section("6. errors")
    for p in ("/api/v1/depth?symbol=NOPEUSDT", "/api/v1/depth", "/api/v1/depth?symbol=BTC_USDT", "/api/v1/markets"):
        st, h, body, ms = api(p)
        print(p, st, body[:120])
    print("x-ratelimit-remaining at end", remaining[0])


if __name__ == "__main__":
    main()
