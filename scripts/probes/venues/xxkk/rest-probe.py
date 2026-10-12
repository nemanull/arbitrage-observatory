# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""XXKK public REST probe for docs/profiles/xxkk/.

XXKK publishes no API, so every call here is one the website itself makes without a login.
Read-only and unauthenticated, about 75 requests at no more than 1 per second.
Run from the repository root with: uv run scripts/probes/venues/xxkk/rest-probe.py
"""

import collections
import email.utils
import http.client
import json
import socket
import ssl
import statistics
import time

WEB = "www.xxkk.com"  # website and its /api/ calls
QUOTE = "q.xkqts.com"  # first swap_quote_domain, serves /wsquote, /mkpai and /market
CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(host: str, path: str, fresh: bool = False):
    """GET over one kept-alive connection per host. Returns status, headers, body, seconds."""
    if fresh or host not in _conns:
        if host in _conns:
            _conns[host].close()
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    t0 = time.perf_counter()
    try:
        conn.request("GET", path, headers=UA)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        conn.close()
        _conns.pop(host, None)
        if fresh:
            raise
        return get(host, path, fresh=True)
    dt = time.perf_counter() - t0
    time.sleep(1.0)
    return resp.status, {k.lower(): v for k, v in resp.getheaders()}, body, dt


def get_json(host: str, path: str):
    status, headers, body, dt = get(host, path)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    return status, headers, body, dt, data


def section(title: str) -> None:
    print(f"\n=== {title}")


def latency() -> None:
    section("1. hosts and latency")
    for host, path in [(WEB, "/api/public/setting/global"), (QUOTE, "/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size=1")]:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        cold = []
        for _ in range(3):
            status, headers, _, dt = get(host, path, fresh=True)
            cold.append(dt)
        warm = []
        for _ in range(5):
            status, headers, _, dt = get(host, path)
            warm.append(dt)
        print(f"{host} addrs={addrs} status={status} server={headers.get('server')} cf-ray={headers.get('cf-ray')}")
        print(f"  cold ms {[round(x * 1000) for x in cold]}  warm ms {[round(x * 1000) for x in warm]} warm median {round(statistics.median(warm) * 1000)}")
    status, _, body, _ = get(WEB, "/api/public/location")
    print("location", status, body[:300])
    status, _, body, _ = get(WEB, "/robots.txt")
    print("robots.txt", status, [line for line in body.splitlines() if line.startswith(("Disallow: /api", "Disallow: /swap", "Content-Signal"))])
    status, _, body, _ = get(WEB, "/en/developers")
    for phrase in ["Public API access is not available yet", "Public API is not currently available", "API Access"]:
        print(f"developers page {status} contains {phrase!r}: {phrase in body}")


def catalog():
    section("2. catalog")
    status, headers, body, dt, data = get_json(WEB, "/api/swap/public/common/exchangeInfo")
    rows = data["data"]
    print(f"exchangeInfo status={status} bytes={len(body)} ms={round(dt * 1000)} rows={len(rows)} cache-control={headers.get('cache-control')}")
    print("by settleCoin", dict(collections.Counter(r["settleCoin"] for r in rows)))
    print("by status", dict(collections.Counter(r["status"] for r in rows)))
    print("by contractType", dict(collections.Counter(r["contractType"] for r in rows)))
    print("by tradeType", dict(collections.Counter(str(r["tradeType"]) for r in rows)))
    print("reverse true", sum(1 for r in rows if r["reverse"]), "delistTime set", sum(1 for r in rows if r["delistTime"]))
    print("contractFactor sample", {r["symbol"]: r["contractFactor"] for r in rows if r["symbol"] in ("btc-usdt", "eth-usdt", "sol-usdc", "nvda-usdt")})
    bases = collections.Counter(r["baseSymbol"] for r in rows)
    print("bases listed in both USDT and USDC", sum(1 for b, n in bases.items() if n > 1))
    status, _, body, _, sym = get_json(WEB, "/api/public/symbol/list")
    d = sym["data"]
    print(f"symbol/list status={status} swap_symbols={len(d['swap_symbols'])} spot_symbols={len(d['spot_symbols'])} lite_symbols={len(d['lite_symbols'])}")
    zone_sizes = {z["code"]: len(z["list"]) for z in d["swap_zones"]}
    print("swap_zones", zone_sizes)
    print("spot_quote_domain", d["spot_quote_domain"], "swap_quote_domain", d["swap_quote_domain"])
    ids_info = {r["symbol"] for r in rows}
    ids_list = {r["code"] for r in d["swap_symbols"]}
    print("exchangeInfo ids equal swap_symbols ids:", ids_info == ids_list)
    tradfi = set(next((z["list"] for z in d["swap_zones"] if z["code"] == "Tradfi"), []))
    print("Tradfi zone contracts", len(tradfi), "of which USDT", sum(1 for s in tradfi if s.endswith("-usdt")))
    return rows


def anchor(rows) -> None:
    section("3. anchor fields")
    btc = next(r for r in rows if r["symbol"] == "btc-usdt")
    keys = ["indexPrice", "flagPrice", "fundRate", "lastFundRate", "nextFundRateTime", "fundRateInterval", "fundRatePeriod", "feeRateTaker", "feeRateMaker"]
    print("btc-usdt", {k: btc[k] for k in keys})
    print("fundRateInterval", dict(collections.Counter(r["fundRateInterval"] for r in rows)))
    print("nextFundRateTime values", dict(collections.Counter(r["nextFundRateTime"] for r in rows)))
    print("rows with null indexPrice", sum(1 for r in rows if r["indexPrice"] is None), "null flagPrice", sum(1 for r in rows if r["flagPrice"] is None))
    rates = [r["fundRate"] for r in rows]
    print("fundRate max", max(rates), "min", min(rates), "count at 0.00375", sum(1 for x in rates if abs(x) == 0.00375), "count at 0", sum(1 for x in rates if x == 0))
    status, headers, body, dt, real = get_json(WEB, "/api/swap/public/future/fundingRate/real")
    rr = real["data"]
    print(f"fundingRate/real status={status} bytes={len(body)} ms={round(dt * 1000)} rows={len(rr)} keys={sorted(rr[0])}")
    print("feeTime values", dict(collections.Counter(r["feeTime"] for r in rr)))
    status, _, body, _, _ = get_json(WEB, "/api/swap/public/future/fundingRate/days?symbol=btc-usdt")
    print("fundingRate/days without limit", status, body[:200])
    status, _, body, _, days = get_json(WEB, "/api/swap/public/future/fundingRate/days?symbol=btc-usdt&limit=5")
    page = days["data"]
    hist = [(r["feeTime"], r["fundRate"]) for r in page["pageData"]]
    print(f"fundingRate/days&limit=5 status={status} totalCount={page['totalCount']} rows={hist}")
    print("lastFundRate equals newest settled fundRate:", btc["lastFundRate"] == hist[0][1], "newest feeTime", hist[0][0], "spacing ms", hist[0][0] - hist[1][0])

    section("4. one minute of polls, exchangeInfo every 2 s")
    seen = collections.defaultdict(list)
    for _ in range(30):
        _, _, _, dt, data = get_json(WEB, "/api/swap/public/common/exchangeInfo")
        b = next(r for r in data["data"] if r["symbol"] == "btc-usdt")
        for k in ("indexPrice", "flagPrice", "fundRate"):
            seen[k].append(b[k])
        seen["ms"].append(round(dt * 1000))
        time.sleep(1.0)
    for k in ("indexPrice", "flagPrice", "fundRate"):
        changes = sum(1 for a, b in zip(seen[k], seen[k][1:]) if a != b)
        print(f"btc-usdt {k}: {changes} changes in {len(seen[k]) - 1} intervals, distinct {len(set(seen[k]))}")
    print("exchangeInfo ms median", statistics.median(seen["ms"]), "max", max(seen["ms"]))


def book() -> None:
    section("5. REST book on the quote host")
    for sym in ["BTC-USDT", "btc-usdt", "BTC_USDT"]:
        status, _, body, dt, data = get_json(QUOTE, f"/mkpai/depth-v2?businessType={sym}&dType=0&size=5")
        d = data["data"]
        print(f"{sym} status={status} v={d['v']} asks={len(d['asks'])} bids={len(d['bids'])} ms={round(dt * 1000)}")
    for size in [1, 50, 200, 500, 1000]:
        status, headers, body, dt, data = get_json(QUOTE, f"/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size={size}")
        d = data["data"]
        asks = [a["price"] for a in d["asks"]]
        bids = [b["price"] for b in d["bids"]]
        print(f"size={size} asks={len(asks)} bids={len(bids)} asks ascending={asks == sorted(asks)} bids descending={bids == sorted(bids, reverse=True)} bytes={len(body)} cache-control={headers.get('cache-control')}")
    _, _, _, _, data = get_json(QUOTE, "/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size=3")
    print("sample", json.dumps(data)[:300])
    vs = []
    for _ in range(5):
        _, _, _, _, data = get_json(QUOTE, "/mkpai/depth-v2?businessType=BTC-USDT&dType=0&size=1")
        vs.append(data["data"]["v"])
    print("v over 5 polls about 1 s apart", vs)
    for sym in ["ETH-USDT", "SOL-USDC", "NVDA-USDT", "NOPE-USDT"]:
        status, _, body, _, data = get_json(QUOTE, f"/mkpai/depth-v2?businessType={sym}&dType=0&size=200")
        print(sym, status, body[:120] if data is None else f"v={data['data']['v']} asks={len(data['data']['asks'])} bids={len(data['data']['bids'])}")
    status, _, body, dt, _ = get_json(QUOTE, "/market?preHour=24")
    print(f"/market?preHour=24 status={status} bytes={len(body)} ms={round(dt * 1000)} sample={body[:200]}")


def errors_and_time() -> None:
    section("6. error shapes")
    for host, path in [(WEB, "/api/swap/public/common/nope"), (WEB, "/api/swap/public/future/fundingRate/days?symbol=nope-usdt&limit=1"), (QUOTE, "/nope")]:
        status, headers, body, _ = get(host, path)
        print(host, path, status, body[:200].replace("\n", " "), "retry-after", headers.get("retry-after"))
    status, headers, _, _ = get(WEB, "/api/swap/public/common/exchangeInfo")
    print("rate limit headers", {k: v for k, v in headers.items() if "limit" in k or "retry" in k})

    section("7. clock offset from the Date header")
    offsets = []
    for _ in range(5):
        t0 = time.time()
        status, headers, _, dt = get(WEB, "/api/public/setting/global")
        server = email.utils.parsedate_to_datetime(headers["date"]).timestamp()
        offsets.append(server - (t0 + dt / 2))
    print("Date header offsets s", [round(x, 2) for x in offsets], "(1 s resolution)")


def main() -> None:
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    latency()
    rows = catalog()
    anchor(rows)
    book()
    errors_and_time()


if __name__ == "__main__":
    main()
