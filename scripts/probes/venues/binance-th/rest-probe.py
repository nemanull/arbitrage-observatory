# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Binance TH spot, for docs/profiles/binance-th/rest.md.

Binance TH lists spot only, so this probe reads the spot catalog, the REST book, the reference price,
the error shapes, the weight headers and the server time, all on public unauthenticated calls.
The mirror mode compares a GLOBAL symbol's book with the same symbol on Binance spot (api.binance.com).

Modes, each runnable alone: host, catalog, book, cache, refprice, errors, time, mirror, all (the default).
Run from the repository root: uv run scripts/probes/venues/binance-th/rest-probe.py [mode]
Captures go to .claude/survey-work/binance-th/.
"""

import collections
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

WORK = Path(".claude/survey-work/binance-th")
API = "https://api.binance.th"
GLOBAL_API = "https://api.binance.com"
UA = "survey-probe/1.0"


def get(url: str) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            raw = reply.read()
            return reply.status, {k.lower(): v for k, v in reply.headers.items()}, raw, (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as error:
        return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read(), (time.perf_counter() - start) * 1000


def api(path: str):
    status, headers, raw, ms = get(API + path)
    if status != 200:
        raise RuntimeError(f"{path} {status} {raw[:200]!r}")
    return json.loads(raw), headers, ms, len(raw)


def save(name: str, obj) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(obj, indent=1))


def host() -> None:
    print("== host")
    for name in ("api.binance.th", "nbstream.binance.th", "www.binance.th"):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        try:
            cname = socket.gethostbyname_ex(name)[0]
        except OSError:
            cname = "?"
        print(f"{name}: canonical {cname}, {len(addrs)} addresses {addrs}")
    times = [get(API + "/api/v1/ping")[3] for _ in range(6)]
    print(f"/api/v1/ping first {times[0]:.0f} ms, then median {statistics.median(times[1:]):.0f} ms, min {min(times[1:]):.0f}, max {max(times[1:]):.0f}")
    status, headers, raw, ms = get(API + "/api/v1/time")
    print(f"/api/v1/time {status} {raw!r} {ms:.0f} ms")
    for key in ("server", "via", "x-cache", "x-amz-cf-pop", "x-mbx-used-weight-1m", "x-mbx-used-weight-10s", "content-encoding"):
        print(f"  header {key}: {headers.get(key)}")
    status, headers, raw, ms = get("https://www.binance.th/")
    print(f"www.binance.th / {status} {ms:.0f} ms")


def catalog() -> None:
    print("== catalog")
    info, headers, ms, size = api("/api/v1/exchangeInfo")
    save("exchangeInfo.json", info)
    symbols = info["symbols"]
    print(f"/api/v1/exchangeInfo {size} bytes in {ms:.0f} ms, weight-1m header {headers.get('x-mbx-used-weight-1m')}")
    print("top level keys", sorted(info), "timezone", info["timezone"])
    print("rateLimits", json.dumps(info["rateLimits"]))
    print("exchangeFilters", info["exchangeFilters"])
    print(f"symbols {len(symbols)}")
    print("status", dict(collections.Counter(s["status"] for s in symbols)))
    print("quote", dict(collections.Counter(s["quoteAsset"] for s in symbols)))
    print("type by quote", dict(collections.Counter(f"{s.get('type')} {s['quoteAsset']}" for s in symbols)))
    print("keys of one symbol", sorted(symbols[0]))
    print("filter types", dict(collections.Counter(f["filterType"] for s in symbols for f in s["filters"])))
    print("orderTypes", dict(collections.Counter(",".join(s["orderTypes"]) for s in symbols)))
    print("test field", dict(collections.Counter(s.get("test") for s in symbols)))
    thb = [(s["symbol"], s["type"]) for s in symbols if s["quoteAsset"] == "THB"]
    print("THB pairs", thb)
    upper = sum(1 for s in symbols if s["symbol"] == s["symbol"].upper())
    joined = sum(1 for s in symbols if s["symbol"] == s["baseAsset"] + s["quoteAsset"])
    print(f"symbol upper case {upper} of {len(symbols)}, symbol equals base+quote {joined} of {len(symbols)}")
    bases = collections.Counter(s["baseAsset"] for s in symbols)
    print(f"distinct bases {len(bases)}, bases with more than one quote {sum(1 for b in bases.values() if b > 1)}")
    types, _, _, _ = api("/api/v1/symbolType")
    print(f"/api/v1/symbolType {len(types)} rows", dict(collections.Counter(t["type"] for t in types)))
    by_info = {s["symbol"]: s.get("type") for s in symbols}
    mismatch = [t for t in types if by_info.get(t["symbol"]) != t["type"]]
    print(f"symbolType rows not in exchangeInfo or with another type: {len(mismatch)} {mismatch[:5]}")
    perps = [s["symbol"] for s in symbols if any(k in s["symbol"] for k in ("PERP", "SWAP", "_"))]
    print("symbols that look like derivatives", perps)
    for path in ("/fapi/v1/exchangeInfo", "/dapi/v1/exchangeInfo", "/api/v1/premiumIndex", "/api/v3/exchangeInfo"):
        status, _, raw, _ = get(API + path)
        print(f"{path} {status} {raw[:120]!r}")
    for url in ("https://www.binance.th/en/futures", "https://www.binance.th/en/markets"):
        status, _, raw, _ = get(url)
        print(f"{url} {status} {len(raw)} bytes")


def book() -> None:
    print("== book")
    for symbol in ("BTCTHB", "USDTTHB", "BTCUSDT", "ETHTHB"):
        for limit in (5, 20, 100, 500, 1000, 5000):
            status, headers, raw, ms = get(f"{API}/api/v1/depth?symbol={symbol}&limit={limit}")
            if status != 200:
                print(f"{symbol} limit {limit}: {status} {raw[:150]!r}")
                continue
            doc = json.loads(raw)
            bids, asks = doc["bids"], doc["asks"]
            bid_desc = all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))
            ask_asc = all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))
            print(f"{symbol} limit {limit}: {len(bids)} bids {len(asks)} asks, bids descending {bid_desc}, asks ascending {ask_asc}, "
                  f"lastUpdateId {doc['lastUpdateId']}, {len(raw)} bytes, {ms:.0f} ms, weight-1m {headers.get('x-mbx-used-weight-1m')}, keys {sorted(doc)}")
            if limit == 5:
                save(f"depth-{symbol}.json", doc)
                print(f"  top {bids[0]} / {asks[0]}, value types {type(bids[0][0]).__name__}")
        time.sleep(0.5)
    status, _, raw, ms = get(f"{API}/api/v1/depth?symbol=BTCTHB")
    doc = json.loads(raw)
    print(f"BTCTHB default limit: {len(doc['bids'])} bids {len(doc['asks'])} asks")
    status, _, raw, _ = get(f"{API}/api/v1/ticker/bookTicker?symbol=BTCTHB")
    print(f"bookTicker BTCTHB {status} {raw!r}")
    status, _, raw, ms = get(f"{API}/api/v1/ticker/bookTicker")
    rows = json.loads(raw)
    print(f"bookTicker without symbol {status}, {len(rows)} rows, {len(raw)} bytes, {ms:.0f} ms")
    empty = [r["symbol"] for r in rows if float(r["bidPrice"]) == 0 or float(r["askPrice"]) == 0]
    print(f"bookTicker rows with an empty side {len(empty)} {empty[:10]}")


def cache() -> None:
    print("== cache, one depth poll a second for 20 s")
    for symbol in ("BTCTHB", "BTCUSDT"):
        ids = []
        for _ in range(20):
            status, headers, raw, ms = get(f"{API}/api/v1/depth?symbol={symbol}&limit=20")
            ids.append(json.loads(raw)["lastUpdateId"])
            time.sleep(1)
        changes = sum(1 for a, b in zip(ids, ids[1:]) if a != b)
        print(f"{symbol}: lastUpdateId changed in {changes} of {len(ids) - 1} one second steps, first {ids[0]} last {ids[-1]}, "
              f"x-cache {headers.get('x-cache')}, cache-control {headers.get('cache-control')}")


def refprice() -> None:
    print("== reference price and execution rules")
    for symbol in ("BTCUSDT", "BTCTHB", "USDTTHB", "ETHTHB", ""):
        q = f"?symbol={symbol}" if symbol else ""
        status, _, raw, ms = get(f"{API}/api/v1/referencePrice{q}")
        print(f"referencePrice {symbol or '(all)'}: {status} {raw[:200]!r} {ms:.0f} ms")
    status, _, raw, ms = get(f"{API}/api/v1/executionRules")
    rows = json.loads(raw)["symbolRules"]
    nulls = sum(1 for r in rows if all(v is None for k, v in r["rules"][0].items() if k != "ruleType"))
    print(f"executionRules (all): {status}, {len(rows)} rows, {nulls} with every multiplier null, {len(raw)} bytes")
    for symbol in ("BTCUSDT", "BTCTHB"):
        status, _, raw, _ = get(f"{API}/api/v1/executionRules?symbol={symbol}")
        print(f"executionRules {symbol}: {status} {raw[:200]!r}")
    values = []
    for _ in range(10):
        status, _, raw, _ = get(f"{API}/api/v1/referencePrice?symbol=BTCUSDT")
        values.append(json.loads(raw))
        time.sleep(1)
    print(f"referencePrice BTCUSDT over 10 one second polls: {len({v['referencePrice'] for v in values})} distinct prices, "
          f"{len({v['timestamp'] for v in values})} distinct timestamps, first {values[0]}")
    status, _, raw, _ = get(f"{API}/api/v1/ticker/price?symbol=BTCUSDT")
    print(f"ticker/price BTCUSDT {raw!r}")


def errors() -> None:
    print("== errors")
    cases = [
        "/api/v1/depth?symbol=NOPETHB",
        "/api/v1/depth?symbol=btcthb&limit=5",
        "/api/v1/depth?symbol=BTC_THB",
        "/api/v1/depth",
        "/api/v1/depth?symbol=BTCTHB&limit=7",
        "/api/v1/depth?symbol=BTCTHB&limit=0",
        "/api/v1/ticker/bookTicker?symbol=NOPE",
        "/api/v1/nope",
        "/api/v3/depth?symbol=BTCTHB",
        "/api/v1/asset/tradeFee",
        "/api/v1/accountV2",
    ]
    for path in cases:
        status, headers, raw, ms = get(API + path)
        print(f"{path}: {status} content-type {headers.get('content-type')} retry-after {headers.get('retry-after')} {raw[:160]!r}")


def clock() -> None:
    print("== time")
    offsets = []
    for _ in range(5):
        before = time.time() * 1000
        status, _, raw, ms = get(API + "/api/v1/time")
        after = time.time() * 1000
        offsets.append(json.loads(raw)["serverTime"] - (before + after) / 2)
        time.sleep(0.3)
    print(f"server minus local, midpoint method, 5 samples: median {statistics.median(offsets):.0f} ms, min {min(offsets):.0f}, max {max(offsets):.0f}")


def mirror() -> None:
    print("== mirror, GLOBAL and SITE books against Binance spot")
    for symbol in ("BTCUSDT", "ETHUSDT", "ETHTHB", "BTCTHB"):
        status_g, _, raw_g, _ = get(f"{GLOBAL_API}/api/v3/depth?symbol={symbol}&limit=20")
        status_t, _, raw_t, _ = get(f"{API}/api/v1/depth?symbol={symbol}&limit=20")
        if status_g != 200 or status_t != 200:
            print(f"{symbol}: binance {status_g} {raw_g[:120]!r}, binance th {status_t} {raw_t[:120]!r}")
            continue
        g, t = json.loads(raw_g), json.loads(raw_t)
        same_prices = sum(1 for a, b in zip(g["bids"] + g["asks"], t["bids"] + t["asks"]) if a[0] == b[0])
        same_levels = sum(1 for a, b in zip(g["bids"] + g["asks"], t["bids"] + t["asks"]) if a == b)
        print(f"{symbol}: binance lastUpdateId {g['lastUpdateId']}, binance th {t['lastUpdateId']}, difference {t['lastUpdateId'] - g['lastUpdateId']}, "
              f"same price on {same_prices} of 40 levels, same price and size on {same_levels} of 40")
        time.sleep(0.5)


MODES = {"host": host, "catalog": catalog, "book": book, "cache": cache, "refprice": refprice, "errors": errors, "time": clock, "mirror": mirror}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    for name, fn in MODES.items():
        if mode in ("all", name):
            fn()
