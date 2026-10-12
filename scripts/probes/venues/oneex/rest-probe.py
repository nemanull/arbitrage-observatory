# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for OneEx (www.oneex.vip), behind docs/profiles/oneex/rest.md and fees.md.

Run from the repository root with: uv run scripts/probes/venues/oneex/rest-probe.py
Every call is an unauthenticated GET, about three a second at most during the one minute poll.
"""

import json
import re
import socket
import statistics
import time
import urllib.error
import urllib.request
from collections import Counter

WEB = "https://www.oneex.vip"
OPEN_API = "https://open-api.oneex.vip"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
POLL_SECONDS = 60


def get(url, timeout=15):
    """Return (status, headers, body bytes, elapsed ms) and never raise on an HTTP error status."""
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        body = e.read()
        return e.code, dict(e.headers), body, (time.perf_counter() - t0) * 1000


def get_json(path, base=WEB):
    status, headers, body, ms = get(base + path)
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        data = None
    return status, headers, body, ms, data


def section(title):
    print(f"\n=== {title}")


def hosts():
    section("DNS")
    for host in ["www.oneex.vip", "ws.oneex.vip", "open-api.oneex.vip", "api.oneex.vip", "openapi.oneex.vip"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
            print(f"{host}: {addrs}")
        except socket.gaierror as e:
            print(f"{host}: no address ({e})")


def latency():
    section("Latency and server time, GET /api/quote/v1/time")
    timings = []
    offsets = []
    for i in range(6):
        t_send = time.time() * 1000
        status, headers, body, ms, data = get_json("/api/quote/v1/time")
        t_recv = time.time() * 1000
        timings.append(ms)
        if data and "data" in data:
            offsets.append(data["data"]["time"] - (t_send + t_recv) / 2)
        if i == 0:
            print(f"cold: status {status}, {ms:.0f} ms, body {body.decode()[:80]}, server header {headers.get('Server')}")
    print(f"warm ms: {[round(t) for t in timings[1:]]}, median {statistics.median(timings[1:]):.0f}")
    print(f"clock offset server minus local, ms: {[round(o) for o in offsets]}, median {statistics.median(offsets):.0f}")


def catalog():
    section("Catalog, GET /s_api/basic/config_v2?tab=exchange&type=all")
    status, headers, body, ms, data = get_json("/s_api/basic/config_v2?tab=exchange&type=all")
    print(f"status {status}, {len(body)} bytes, {ms:.0f} ms")
    fut = data["futuresSymbol"]
    print(f"futuresSymbol rows: {len(fut)}")
    keyed = Counter((s["quoteTokenId"], s["status"], s["canTrade"], s["showStatus"], s["isReverse"]) for s in fut)
    for k, n in sorted(keyed.items()):
        print(f"  quote {k[0]} status {k[1]} canTrade {k[2]} showStatus {k[3]} isReverse {k[4]}: {n}")
    live = [s for s in fut if s["status"] and s["canTrade"]]
    print(f"tradable rows: {len(live)}, settle tokens {Counter(s['baseTokenFutures']['coinToken'] for s in live)}")
    print(f"hidden but tradable: {[s['symbolId'] for s in live if not s['showStatus']]}")
    print(f"exchangeId values: {Counter(s['exchangeId'] for s in fut)}")
    print(f"settlementDate values: {Counter(s['baseTokenFutures']['settlementDate'] for s in fut)}")
    bases = Counter(s["secondLevelUnderlyingId"] for s in live)
    print(f"underlyings listed twice among tradable rows: {[b for b, n in bases.items() if n > 1]}")
    btc = next(s for s in fut if s["symbolId"] == "BTC-SWAP-USDT")
    b = btc["baseTokenFutures"]
    print(
        "BTC-SWAP-USDT:",
        {
            "contractMultiplier": b["contractMultiplier"],
            "minPricePrecision": btc["minPricePrecision"],
            "minTradeQuantity": btc["minTradeQuantity"],
            "indexToken": b["indexToken"],
            "maxLeverage": b["maxLeverage"],
            "first riskLimit": b["riskLimits"][0],
            "marketPriceRange": b["marketPriceRange"],
            "overPriceRange": b["overPriceRange"],
        },
    )
    print("tradable multipliers:", sorted({(s["symbolId"], s["baseTokenFutures"]["contractMultiplier"]) for s in live}))
    print(f"futuresUnderlying: {data['futuresUnderlying']}, futuresCoinToken: {data['futuresCoinToken']}")
    print(f"optionSymbol rows: {len(data['optionSymbol'])}, foreignExchangeSymbol rows: {len(data['foreignExchangeSymbol'])}")
    spot = data["symbol"]
    sk = Counter((s["quoteTokenId"], s["status"], s["canTrade"], s["showStatus"]) for s in spot)
    print(f"spot symbol rows: {len(spot)}")
    for k, n in sorted(sk.items()):
        print(f"  spot quote {k[0]} status {k[1]} canTrade {k[2]} showStatus {k[3]}: {n}")
    print(f"functions: {data['functions']}")
    countries = data["country"]
    print(
        f"country rows: {len(countries)}, allowRegister 0: {[c['countryName'] for c in countries if not c.get('allowRegister')]}, "
        f"allowKyc 0: {[c['countryName'] for c in countries if not c.get('allowKyc')]}"
    )
    print("Canada row:", [c for c in countries if c["shortName"] == "CA"])
    return live


def anchor(live):
    section("Funding, GET /api/contract/funding_rates")
    status, headers, body, ms, rows = get_json("/api/contract/funding_rates")
    print(f"status {status}, {len(body)} bytes, {ms:.0f} ms, rows {len(rows)}")
    print("BTC row:", next(r for r in rows if r["tokenId"] == "BTC-SWAP-USDT"))
    ids = {r["tokenId"] for r in rows}
    live_ids = {s["symbolId"] for s in live}
    print(f"tradable rows missing from funding: {sorted(live_ids - ids)}, funding rows not tradable: {sorted(ids - live_ids)}")
    intervals = Counter((int(r["nextSettleTime"]) - int(r["lastSettleTime"])) / 3_600_000 for r in rows)
    print(f"interval hours (nextSettleTime - lastSettleTime): {dict(intervals)}")
    nexts = Counter(time.strftime("%H:%M UTC", time.gmtime(int(r["nextSettleTime"]) / 1000)) for r in rows)
    print(f"nextSettleTime as UTC clock: {dict(nexts)}")
    rates = [float(r["fundingRate"]) for r in rows]
    print(f"fundingRate min {min(rates)}, max {max(rates)}")
    big = [(r["tokenId"], r["fundingRate"], r["settleRate"]) for r in rows if abs(float(r["fundingRate"])) >= 0.001]
    print(f"rows with |fundingRate| >= 0.001: {big}")
    live_rates = [float(r["fundingRate"]) for r in rows if r["tokenId"] in live_ids]
    print(f"tradable rows fundingRate min {min(live_rates)}, max {max(live_rates)}")
    shown_ids = {s["symbolId"] for s in live if s["showStatus"]}
    shown_rates = [float(r["fundingRate"]) for r in rows if r["tokenId"] in shown_ids]
    print(f"{len(shown_rates)} shown rows fundingRate min {min(shown_rates)}, max {max(shown_rates)}")
    print(f"distinct curServerTime values in one reply: {len({r['curServerTime'] for r in rows})}")

    section("Index in bulk, GET /api/quote/v1/indices?symbol=<comma list>")
    tokens = sorted({s["baseTokenFutures"]["indexToken"] for s in live})
    status, headers, body, ms, data = get_json("/api/quote/v1/indices?symbol=" + ",".join(tokens))
    print(f"{len(tokens)} index tokens asked, status {status}, {len(body)} bytes, {ms:.0f} ms, returned {len(data.get('data') or {})}")
    print(f"BTCUSDT {data['data'].get('BTCUSDT')}, missing {sorted(set(tokens) - set(data['data']))}")
    for path in ["/api/quote/v1/indices", "/api/quote/v1/index?symbol=BTCUSDT", "/api/quote/v1/markPrice?symbol=BTC-SWAP-USDT"]:
        status, headers, body, ms, data = get_json(path)
        print(f"{path}: status {status}, body {body.decode()[:120]}")

    section("Mark and index klines per index token, 1m close")
    for path in [
        "/api/quote/v1/mark/klines?symbol=BTCUSDT&interval=1m&limit=1",
        "/api/quote/v1/index/klines?symbol=BTCUSDT&interval=1m&limit=1",
        "/api/quote/v1/mark/klines?symbol=BTCUSDT,ETHUSDT&interval=1m&limit=1",
        "/api/quote/v1/mark/klines?symbol=BTC-SWAP-USDT&interval=1m&limit=1",
        "/api/quote/v1/ticker?symbol=301.BTC-SWAP-USDT",
    ]:
        status, headers, body, ms, data = get_json(path)
        print(f"{path}: status {status}, {ms:.0f} ms, body {body.decode()[:260]}")
    status, headers, body, ms, data = get_json("/api/quote/v1/broker/tickers")
    tick = data["data"]
    print(f"/api/quote/v1/broker/tickers: status {status}, {len(body)} bytes, {ms:.0f} ms, rows {len(tick)}, SWAP rows {sum('-SWAP-' in t['s'] for t in tick)}")
    print(f"  ticker keys {sorted(tick[0].keys())}")


def poll():
    section(f"One second polls for {POLL_SECONDS} s: funding row, bulk index, BTC mark kline, BTC last price")
    series = {"fundingRate": [], "index": [], "mark": [], "last": []}
    times = {"funding": [], "indices": [], "mark": []}
    for _ in range(POLL_SECONDS):
        t0 = time.time()
        _, _, _, ms, rows = get_json("/api/contract/funding_rates")
        times["funding"].append(ms)
        series["fundingRate"].append(next(r["fundingRate"] for r in rows if r["tokenId"] == "BTC-SWAP-USDT"))
        _, _, _, ms, data = get_json("/api/quote/v1/indices?symbol=BTCUSDT,ETHUSDT")
        times["indices"].append(ms)
        series["index"].append(data["data"]["BTCUSDT"])
        _, _, _, ms, data = get_json("/api/quote/v1/mark/klines?symbol=BTCUSDT&interval=1m&limit=1")
        times["mark"].append(ms)
        series["mark"].append(data["data"][0]["c"])
        _, _, _, _, data = get_json("/api/quote/v1/ticker?symbol=301.BTC-SWAP-USDT")
        series["last"].append(data["data"][0]["c"])
        time.sleep(max(0.0, 1.0 - (time.time() - t0)))
    for k, v in series.items():
        changes = sum(1 for a, b in zip(v, v[1:]) if a != b)
        print(f"{k}: {changes} changes in {len(v)} polls, first {v[0]}, last {v[-1]}")
    for k, v in times.items():
        print(f"{k} reply ms: median {statistics.median(v):.0f}, max {max(v):.0f}")
    gaps = [abs(float(m) - float(i)) / float(i) * 1e6 for m, i in zip(series["mark"], series["index"])]
    mark_last = [abs(float(m) - float(l)) / float(l) * 1e6 for m, l in zip(series["mark"], series["last"])]
    print(f"mark vs index ppm: median {statistics.median(gaps):.0f}, max {max(gaps):.0f}")
    print(f"mark vs last price ppm: median {statistics.median(mark_last):.0f}, max {max(mark_last):.0f}")


def book():
    section("REST book, GET /api/quote/v1/depth?symbol=301.<id>&limit=<n>")
    for limit in [5, 20, 100, 500]:
        time.sleep(3.5)  # let the cache entry of the previous call expire
        status, headers, body, ms, data = get_json(f"/api/quote/v1/depth?symbol=301.BTC-SWAP-USDT&limit={limit}")
        d = data["data"][0]
        bids = [float(p) for p, _ in d["b"]]
        asks = [float(p) for p, _ in d["a"]]
        print(
            f"limit {limit}: status {status}, {len(body)} bytes, {ms:.0f} ms, levels {len(d['b'])}/{len(d['a'])}, "
            f"bids descending {bids == sorted(bids, reverse=True)}, asks ascending {asks == sorted(asks)}, v {d['v']}, t {d['t']}"
        )
    status, headers, body, ms, data = get_json("/api/quote/v1/depth?symbol=BTC-SWAP-USDT&limit=5")
    print(f"without the 301. prefix: status {status}, body {body.decode()[:160]}")
    status, headers, body, ms, data = get_json("/api/quote/v1/depth?symbol=301.FOO-SWAP-USDT&limit=5")
    print(f"unknown symbol: status {status}, body {body.decode()[:160]}")
    status, headers, body, ms, data = get_json("/api/quote/v1/depth?symbol=301.BTC-SWAP-USDH&limit=5")
    print(f"closed USDH row: status {status}, body {body.decode()[:200]}")
    vs = []
    for _ in range(5):
        _, _, _, _, data = get_json("/api/quote/v1/depth?symbol=301.BTC-SWAP-USDT&limit=20")
        vs.append((data["data"][0]["v"], data["data"][0]["t"]))
        time.sleep(0.2)
    print(f"five calls 200 ms apart, (v, t): {vs}")
    time.sleep(3.5)
    pair = []
    for limit in [100, 5]:
        _, _, _, _, data = get_json(f"/api/quote/v1/depth?symbol=301.ETH-SWAP-USDT&limit={limit}")
        d = data["data"][0]
        pair.append((limit, d["v"], len(d["b"]), len(d["a"])))
    print(f"ETH limit 100 then limit 5 back to back, (limit, v, bids, asks): {pair}")
    print("rate limit headers on a depth reply:", {k: v for k, v in headers.items() if re.search("limit|retry|remaining", k, re.I)})


def external_index():
    section("External reference, OKX BTC-USDT index, one call")
    _, _, _, _, ours = get_json("/api/quote/v1/indices?symbol=BTCUSDT")
    status, _, body, ms = get("https://www.okx.com/api/v5/market/index-tickers?instId=BTC-USDT")
    okx = json.loads(body)["data"][0]["idxPx"]
    mine = ours["data"]["BTCUSDT"]
    print(f"OneEx BTCUSDT index {mine}, OKX BTC-USDT index {okx} (status {status}), gap {abs(float(mine) - float(okx)) / float(okx) * 1e6:.0f} ppm")


def refused():
    section("open-api.oneex.vip, the broker OpenAPI host")
    for path in ["/openapi/v1/time", "/openapi/v1/brokerInfo", "/openapi/quote/v1/contract/index?symbol=BTCUSDT"]:
        status, headers, body, ms = get(OPEN_API + path)
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace"))).strip()
        print(f"{path}: status {status}, server {headers.get('Server')}, pop {headers.get('X-Amz-Cf-Pop')}, body: {text[:260]}")
    for path in ["/openapi/v1/time", "/api/v1/time"]:
        status, headers, body, ms = get(WEB + path)
        print(f"www{path}: status {status}, content-type {headers.get('Content-Type')}, {len(body)} bytes (the SPA shell when text/html)")


def articles():
    section("Help center articles, GET /api/v1/learning/center/article/detail?articleBaseId=<id>")
    for aid in [
        "c03a5461c0b744c0b541c758155ef64d",  # OneEx Trading Fees
        "b64d2f35186f412098c999f8c9fea0e7",  # Funding Fee Introduction
        "b5f5eb28160c41808b1d627ba3b5832e",  # Introduction to Index Price and Mark Price
        "ba15ee02c21b45749adbbbf7602b7ede",  # Terms of Use
    ]:
        status, headers, body, ms, data = get_json(f"/api/v1/learning/center/article/detail?articleBaseId={aid}")
        desc = data.get("description", "")
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", desc))
        released = time.strftime("%Y-%m-%d", time.gmtime(int(data["releaseTime"]) / 1000))
        print(f"{aid}: status {status}, title {data['title']!r}, released {released}, text chars {len(text)}")
        print(f"  images: {re.findall(r'src=.([^\"]+)', desc)}")
        for pat in ["every 8 hours", "00:00", "bot trading", "Binance, Coinbase, Kraken", "Basis Deviation"]:
            if pat in text:
                i = text.index(pat)
                print(f"  {pat!r}: ...{text[max(0, i - 90): i + 90]}...")
    status, headers, body, ms, data = get_json("/api/v1/learning/center/article/list?pageSize=50&current=1")
    print(f"article list: status {status}, total {data['total']}")


def main():
    print(f"OneEx REST probe, local start {time.strftime('%Y-%m-%d %H:%M:%S %Z')}, UTC {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
    hosts()
    latency()
    live = catalog()
    anchor(live)
    book()
    external_index()
    refused()
    articles()
    poll()


if __name__ == "__main__":
    main()
