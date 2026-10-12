# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Dzengi public REST probe, read-only and unauthenticated.

Dzengi documents its REST API in the Swagger group public-api at https://apitradedoc.dzengi.com/v2/api-docs?group=public-api, with the base https://api-adapter.dzengi.com.
The probe makes about 50 requests, far inside the published 1200 request weight per minute.

Run from the repository root: uv run scripts/probes/venues/dzengi/rest-probe.py
"""

import collections
import json
import pathlib
import socket
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

HOST = "api-adapter.dzengi.com"
BASE = f"https://{HOST}"
UA = "arbitrage-observatory venue survey probe"
WORK = pathlib.Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "dzengi"
KEEP_HEADERS = ("content-type", "content-encoding", "cache-control", "age", "cf-cache-status", "cf-ray", "retry-after", "server")


def get(path, params=None):
    url = BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body, status, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        body, status, hdrs = e.read(), e.code, e.headers
    ms = (time.perf_counter() - t0) * 1000
    kept = {k.lower(): v for k, v in hdrs.items() if k.lower() in KEEP_HEADERS or k.lower().startswith(("x-", "ratelimit"))}
    return status, kept, body, ms


def short(body, n=300):
    s = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
    return s if len(s) <= n else s[:n] + "...(trimmed)"


def section(title):
    print(f"\n## {title}")


def access():
    section("0. access from this exit")
    req = urllib.request.Request("https://dzengi.com/cdn-cgi/trace", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        trace = dict(line.split("=", 1) for line in r.read().decode().split("\n") if "=" in line)
    print("dzengi.com Cloudflare trace: loc", trace.get("loc"), "colo", trace.get("colo"))
    for url in ["https://dzengi.com/", "https://dzengi.com/api", "https://apitradedoc.dzengi.com/v2/api-docs?group=public-api"]:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f"GET {url}: {r.status}, {len(r.read())} bytes")
        except urllib.error.HTTPError as e:
            print(f"GET {url}: {e.code} {short(e.read())}")
    for host in ["api-adapter.backend.dzengi.com", "api-adapter.backend.currency.com", "demo-api-adapter.dzengi.com"]:
        try:
            print("resolve", host, sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)}))
        except socket.gaierror as e:
            print("resolve", host, "failed:", e)
    old = "https://api-adapter.backend.currency.com/api/v2/time"  # the Currency.com host CCXT's removed class used
    try:
        with urllib.request.urlopen(urllib.request.Request(old, headers={"User-Agent": UA}), timeout=20) as r:
            print(f"GET {old}: {r.status} {short(r.read())}")
    except Exception as e:
        print(f"GET {old}: {type(e).__name__} {e}")


def host_and_latency():
    section("1. host and latency")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    print("resolved", HOST, addrs)
    cold = []
    for _ in range(3):
        # urllib opens a new TCP and TLS connection per request, so every call here is cold
        status, hdrs, body, ms = get("/api/v2/time")
        cold.append(ms)
    print(f"GET /api/v2/time x3, new connection each: {[round(x) for x in cold]} ms, status {status}, body {short(body)}, headers {hdrs}")
    import http.client

    conn = http.client.HTTPSConnection(HOST, timeout=20)
    warm = []
    for i in range(6):
        t0 = time.perf_counter()
        conn.request("GET", "/api/v2/time", headers={"User-Agent": UA})
        r = conn.getresponse()
        r.read()
        if i:
            warm.append((time.perf_counter() - t0) * 1000)
    conn.close()
    print(f"warm keep-alive GET /api/v2/time x5: {[round(x) for x in warm]} ms, median {statistics.median(warm):.0f} ms")


def clock():
    section("7. server time and clock offset")
    offsets = []
    for _ in range(5):
        t0 = time.time() * 1000
        status, hdrs, body, ms = get("/api/v2/time")
        t1 = time.time() * 1000
        server = json.loads(body)["serverTime"]
        offsets.append(server - (t0 + t1) / 2)
    print(f"offset server minus local midpoint, 5 samples: {[round(x) for x in offsets]} ms, median {statistics.median(offsets):.0f} ms")
    print("v1 path:", get("/api/v1/time")[0], short(get("/api/v1/time")[2]))


def catalog():
    section("2. catalog")
    status, hdrs, body, ms = get("/api/v2/exchangeInfo")
    info = json.loads(body)
    (WORK / "exchangeInfo-probe.json").write_bytes(body)
    rows = info["symbols"]
    print(f"GET /api/v2/exchangeInfo: status {status}, {len(body)} bytes, {ms:.0f} ms, headers {hdrs}")
    print("top level keys:", list(info), "rateLimits:", json.dumps(info["rateLimits"]))
    uniq = {}
    for r in rows:
        uniq.setdefault(r["symbol"], []).append(r)
    dup = {k: v for k, v in uniq.items() if len(v) > 1}
    same = all(all(json.dumps(x, sort_keys=True) == json.dumps(v[0], sort_keys=True) for x in v) for v in dup.values())
    print(f"rows {len(rows)}, unique symbols {len(uniq)}, symbols listed more than once {len(dup)}, max copies {max(len(v) for v in uniq.values())}, duplicate rows identical {same}")
    one = [v[0] for v in uniq.values()]
    c = collections.Counter((r["marketType"], r["assetType"], r["status"]) for r in one)
    print("unique symbols by (marketType, assetType, status):", sorted(c.items(), key=lambda x: -x[1]))
    print("status values:", dict(collections.Counter(r["status"] for r in one)))

    spot = [r for r in one if r["marketType"] == "SPOT" and r["assetType"] == "CRYPTOCURRENCY" and r["status"] == "TRADING"]
    print(f"spot crypto TRADING: {len(spot)}, by quote {dict(collections.Counter(r['quoteAsset'] for r in spot))}")
    print("spot crypto TRADING exchangeFee by quote:", dict(collections.Counter((r["quoteAsset"], r.get("exchangeFee")) for r in spot)))
    print("spot crypto TRADING with USD quote and exchangeFee 0.2:", [r["symbol"] for r in spot if r["quoteAsset"] == "USD" and r.get("exchangeFee") == 0.2])
    bases = collections.Counter(r["baseAsset"] for r in spot)
    usd_family = collections.Counter(r["baseAsset"] for r in spot if r["quoteAsset"] in ("USD", "USDT", "USDC"))
    print(f"spot crypto bases {len(bases)}, bases listed on both USD and USDT {sum(1 for b, n in usd_family.items() if n > 1)}")
    print("spot sample row:", json.dumps(next(r for r in spot if r["symbol"] == "BTC/USDT")))

    lev = [r for r in one if r["marketType"] == "LEVERAGE" and r["assetType"] == "CRYPTOCURRENCY"]
    lt = [r for r in lev if r["status"] == "TRADING"]
    print(f"leverage crypto: {len(lev)} unique, TRADING {len(lt)}, by quote {dict(collections.Counter(r['quoteAsset'] for r in lt))}")
    print("leverage crypto tradingFee:", dict(collections.Counter(r.get("tradingFee") for r in lt)))
    print("leverage crypto tradingFee 0.06 symbols:", [r["symbol"] for r in lt if r.get("tradingFee") == 0.06])
    print("leverage crypto swapChargeInterval:", dict(collections.Counter(r.get("swapChargeInterval") for r in lt)))
    print("leverage crypto swapChargeInterval 480 symbols:", [r["symbol"] for r in lt if r.get("swapChargeInterval") == 480])
    print("leverage longRate, shortRate for BTC and ETH:", [(r["symbol"], r["longRate"], r["shortRate"]) for r in lt if r["baseAsset"] in ("BTC", "ETH")])
    print("leverage longRate range:", min(r["longRate"] for r in lt), max(r["longRate"] for r in lt), "shortRate range:", min(r["shortRate"] for r in lt), max(r["shortRate"] for r in lt))
    lev_keys = sorted(set(k for r in lt for k in r))
    print("leverage row keys:", lev_keys)
    print("any key naming mark, index, funding, expiry or contract:", [k for k in lev_keys if any(w in k.lower() for w in ("mark", "index", "fund", "expir", "contract", "settle"))])
    print("leverage sample row:", json.dumps(next(r for r in lt if r["symbol"] == "BTC/USD_LEVERAGE")))
    return one


def books():
    section("5. REST book")
    for sym, lim in [("BTC/USDT", None), ("BTC/USDT", 5), ("BTC/USDT", 100), ("BTC/USDT", 1000), ("BTC/USD_LEVERAGE", 10), ("ETH/USD_LEVERAGE", None)]:
        params = {"symbol": sym}
        if lim is not None:
            params["limit"] = lim
        status, hdrs, body, ms = get("/api/v2/depth", params)
        if status != 200:
            print(f"depth {sym} limit={lim}: status {status} {short(body)}")
            continue
        d = json.loads(body)
        bids = [p for p, q in d["bids"]]
        asks = [p for p, q in d["asks"]]
        print(
            f"depth {sym} limit={lim}: {status}, {ms:.0f} ms, {len(body)} bytes, bids {len(bids)}, asks {len(asks)}, lastUpdateId {d['lastUpdateId']}, "
            f"bids descending {bids == sorted(bids, reverse=True)}, asks ascending {asks == sorted(asks)}, first level types {[type(x).__name__ for x in d['bids'][0]] if d['bids'] else None}, "
            f"top {d['bids'][:2]} / {d['asks'][:2]}, headers {hdrs}"
        )
    local = time.time() * 1000
    d = json.loads(get("/api/v2/depth", {"symbol": "BTC/USDT", "limit": 5})[2])
    print(f"lastUpdateId minus local ms clock: {d['lastUpdateId'] - local:.0f} ms, so lastUpdateId reads as a millisecond timestamp")
    ids = []
    for _ in range(5):
        ids.append(json.loads(get("/api/v2/depth", {"symbol": "BTC/USDT", "limit": 5})[2])["lastUpdateId"])
        time.sleep(0.5)
    print("five BTC/USDT depth calls 0.5 s apart, lastUpdateId:", ids, "distinct", len(set(ids)))
    for sym in ["NOPE/USD", "BTC/USDT_LEVERAGE", "BTC-USDT"]:
        status, hdrs, body, ms = get("/api/v2/depth", {"symbol": sym})
        print(f"depth {sym}: status {status} {short(body)}")


def tickers_and_fees(one):
    section("3. tickers, fees and anchor candidates")
    t = []
    for attempt in range(1, 5):
        status, hdrs, body, ms = get("/api/v2/ticker/24hr")
        t = json.loads(body)
        print(f"GET /api/v2/ticker/24hr (all), attempt {attempt}: status {status}, {len(body)} bytes, {ms:.0f} ms, rows {len(t) if isinstance(t, list) else type(t).__name__}")
        if isinstance(t, list) and t:
            break
        time.sleep(3)
    if isinstance(t, list) and t:
        print("ticker keys:", sorted(set(k for r in t for k in r)))
        lev_t = next((r for r in t if r.get("symbol") == "BTC/USD_LEVERAGE"), None)
        print("ticker BTC/USD_LEVERAGE in the all-symbol reply:", json.dumps(lev_t))
        kind = {r["symbol"]: r for r in one}
        spot_t = [r for r in t if kind.get(r["symbol"], {}).get("marketType") == "SPOT" and kind[r["symbol"]]["assetType"] == "CRYPTOCURRENCY" and kind[r["symbol"]]["status"] == "TRADING"]
        traded = [r for r in spot_t if float(r.get("volume") or 0) > 0]
        print(f"spot crypto TRADING rows in the all-symbol ticker: {len(spot_t)}, with nonzero 24 h volume {len(traded)}")
        top = sorted(traded, key=lambda r: -float(r.get("quoteVolume") or 0))[:8]
        print("largest spot quoteVolume:", [(r["symbol"], r["quoteVolume"]) for r in top])
        print("closeTime spread in the all-symbol reply, now minus closeTime, min and max s:", round((time.time() * 1000 - max(r["closeTime"] for r in t)) / 1000), round((time.time() * 1000 - min(r["closeTime"] for r in t)) / 1000))
    else:
        print("all-symbol ticker returned an empty or non-list body:", short(body))
    for sym in ["BTC/USDT", "BTC/USD_LEVERAGE"]:
        status, hdrs, body, ms = get("/api/v2/ticker/24hr", {"symbol": sym})
        print(f"GET /api/v2/ticker/24hr symbol={sym}: status {status}, {ms:.0f} ms, {short(body, 500)}")
    status, hdrs, body, ms = get("/api/v2/tradingFees")
    f = json.loads(body)
    print(f"GET /api/v2/tradingFees without credentials: status {status}, {len(body)} bytes, rows {len(f)}")
    kind = {r["symbol"]: r for r in one}
    crypto_fee = collections.Counter(r["fee"] for r in f if kind.get(r["symbol"], {}).get("assetType") == "CRYPTOCURRENCY")
    print("tradingFees fee values on crypto symbols:", dict(crypto_fee))
    print("tradingFees rows naming _LEVERAGE:", sum(1 for r in f if "_LEVERAGE" in r["symbol"]), "distinct symbols", len({r["symbol"] for r in f}))
    print("tradingFees every row for BTC/USDT, BTC/USD, ETH/USDT, RVN/BTC:", [r for r in f if r["symbol"] in ("BTC/USDT", "BTC/USD", "ETH/USDT", "RVN/BTC")])
    print("exchangeInfo for the same:", [(r["symbol"], r["marketType"], r.get("exchangeFee"), r.get("tradingFee")) for r in one if r["symbol"].replace("_LEVERAGE", "") in ("BTC/USDT", "BTC/USD", "ETH/USDT", "RVN/BTC")])
    for path, params in [
        ("/api/v2/premiumIndex", None),
        ("/api/v2/fundingRate", None),
        ("/api/v2/markPrice", None),
        ("/api/v2/leverageSettings", {"symbol": "BTC/USD_LEVERAGE"}),
        ("/api/v2/currencies", None),
    ]:
        status, hdrs, body, ms = get(path, params)
        print(f"GET {path} {params or ''}: status {status} {short(body, 200)}")


def errors_and_limits():
    section("6. error shapes and limit headers")
    status, hdrs, body, ms = get("/api/v2/klines", {"symbol": "BTC/USDT", "interval": "1m", "limit": 2})
    print(f"klines BTC/USDT 1m limit 2: {status} {short(body, 200)} headers {hdrs}")
    status, hdrs, body, ms = get("/api/v2/klines", {"symbol": "BTC/USDT", "interval": "7m"})
    print(f"klines bad interval: {status} {short(body, 200)}")
    status, hdrs, body, ms = get("/api/v2/nothingHere")
    print(f"unknown path: {status} {short(body, 200)}")


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    print("probe start UTC", time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime()))
    access()
    host_and_latency()
    one = catalog()
    tickers_and_fees(one)
    books()
    errors_and_limits()
    clock()


if __name__ == "__main__":
    main()
