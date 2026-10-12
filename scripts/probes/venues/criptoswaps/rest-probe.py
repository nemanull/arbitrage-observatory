# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CriptoSwaps public REST probe for docs/profiles/criptoswaps/.

CriptoSwaps runs the Openware OpenDAX stack, so its public REST surface is Peatio's /api/v2/peatio/public/.
Read-only and unauthenticated, about 70 requests at no more than about 2 per second.
Run from the repository root with: uv run scripts/probes/venues/criptoswaps/rest-probe.py
"""

import collections
import datetime
import email.utils
import http.client
import json
import socket
import ssl
import statistics
import time

HOST = "www.criptoswaps.com"
PUB = "/api/v2/peatio/public"
CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(path: str, host: str = HOST, fresh: bool = False):
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
        return get(path, host, fresh=True)
    return resp.status, dict((k.lower(), v) for k, v in resp.getheaders()), body, time.perf_counter() - t0


def section(title: str) -> None:
    print(f"\n=== {title}")


def host_and_latency() -> None:
    section("1. host and latency")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    print("resolved", HOST, addrs)
    st, h, body, cold = get(f"{PUB}/timestamp", fresh=True)
    print("cold", st, round(cold * 1000), "ms", "server", h.get("server"), "cf-ray", h.get("cf-ray"), "cf-cache-status", h.get("cf-cache-status"))
    warm = []
    for _ in range(8):
        time.sleep(0.5)
        warm.append(get(f"{PUB}/timestamp")[3] * 1000)
    print("warm ms", [round(x) for x in warm], "median", round(statistics.median(warm)))
    st, _, body, _ = get("/api/v2/sonic/public/config")  # the start script redirects to /restriction on 471 and /maintenance on 472, 503 or 513
    cfg = json.loads(body) if st == 200 else {}
    print("GET /api/v2/sonic/public/config", st, {k: cfg.get(k) for k in ("incrementalOrderBook", "finex", "rangerReconnectPeriod")})


def catalog() -> dict:
    section("2. catalog")
    st, h, body, t = get(f"{PUB}/markets")
    markets = json.loads(body)
    print("GET /markets", st, len(body), "bytes", round(t * 1000), "ms", "rows", len(markets))
    print("type and state", dict(collections.Counter((m["type"], m["state"]) for m in markets)))
    print("quote units", dict(collections.Counter(m["quote_unit"] for m in markets)))
    print("first row", json.dumps(markets[0]))
    ids = [m["id"] for m in markets]
    print("id equals symbol on every row", all(m["id"] == m["symbol"] for m in markets))
    print("id is lowercase base plus quote on every row", all(m["id"] == m["base_unit"] + m["quote_unit"] for m in markets))
    st, _, body, _ = get(f"{PUB}/markets?limit=1000")
    print("GET /markets?limit=1000", st, "rows", len(json.loads(body)))
    for typ in ("qe", "futures", "spot"):
        st, _, body, _ = get(f"{PUB}/markets?type={typ}")
        print(f"GET /markets?type={typ}", st, body[:80] if st != 200 else f"rows {len(json.loads(body))}")
    st, _, body, t = get(f"{PUB}/markets/tickers")
    tick = json.loads(body)
    print("GET /markets/tickers", st, len(body), "bytes", round(t * 1000), "ms", "keys", len(tick))
    print("ticker keys equal market ids", set(tick) == set(ids))
    zero = [k for k, v in tick.items() if float(v["ticker"]["amount"]) == 0]
    print("markets with zero 24h base amount", len(zero), sorted(zero))
    print("btcusdt ticker", json.dumps(tick.get("btcusdt")))
    try:
        st, _, body, _ = get("/data-api/v3/exchange/market-pairs/latest?slug=criptoswaps&category=spot&start=1&limit=1", host="api.coinmarketcap.com")
        print("CoinMarketCap numMarketPairs", st, json.loads(body)["data"]["numMarketPairs"])
    except Exception as e:  # context only, never fatal
        print("CoinMarketCap read failed", e)
    return {m["id"]: m for m in markets}


def no_anchor() -> None:
    section("3. index, mark and funding")
    st, _, body, t = get(f"{PUB}/currencies")
    cur = json.loads(body)
    print("GET /currencies", st, "rows", len(cur), "fields", sorted(cur[0].keys()))
    btc = next(c for c in cur if c["id"] == "btc")
    print("btc price field", btc["price"], "deposit_enabled", btc["deposit_enabled"], "withdrawal_enabled", btc["withdrawal_enabled"])
    print("currencies with deposit_enabled", [c["id"] for c in cur if c.get("deposit_enabled")], "withdrawal_enabled", [c["id"] for c in cur if c.get("withdrawal_enabled")])
    for path in ("/funding_rates", "/markets/btcusdt/funding", "/qe/prices", "/markets/btcusdt/mark_price"):
        st, _, body, _ = get(f"{PUB}{path}")
        print("GET", path, st, body[:80])


def levels_ok(side: list, ascending: bool) -> bool:
    px = [float(p) for p, _ in side]
    return px == sorted(px, reverse=not ascending)


def rest_book() -> None:
    section("4. REST book")
    st, h, body, t = get(f"{PUB}/markets/btcusdt/depth")
    d = json.loads(body)
    print("GET /markets/btcusdt/depth", st, len(body), "bytes", round(t * 1000), "ms", "cf-cache-status", h.get("cf-cache-status"), "cache-control", h.get("cache-control"))
    print("keys", list(d), "asks", len(d["asks"]), "bids", len(d["bids"]), "asks ascending", levels_ok(d["asks"], True), "bids descending", levels_ok(d["bids"], False))
    print("best ask", d["asks"][0], "best bid", d["bids"][0], "timestamp", d["timestamp"])
    for lim in (1, 5, 50, 1000, 5000):
        st, _, body, _ = get(f"{PUB}/markets/btcusdt/depth?limit={lim}")
        if st == 200:
            dd = json.loads(body)
            print(f"depth limit={lim}", st, "asks", len(dd["asks"]), "bids", len(dd["bids"]))
        else:
            print(f"depth limit={lim}", st, body[:100])
    for lim in (20, 200, 201):
        st, _, body, _ = get(f"{PUB}/markets/btcusdt/order-book?asks_limit={lim}&bids_limit={lim}")
        if st == 200:
            ob = json.loads(body)
            print(f"order-book limit={lim}", st, len(body), "bytes", "asks", len(ob["asks"]), "bids", len(ob["bids"]))
        else:
            print(f"order-book limit={lim}", st, body[:100])
    st, _, body, _ = get(f"{PUB}/markets/btcusdt/order-book")
    ob = json.loads(body)
    print("order-book default", "asks", len(ob["asks"]), "bids", len(ob["bids"]), "order fields", sorted(ob["asks"][0].keys()))

    print("depth polls, 1 s apart, 12 polls")
    tops, stamps = [], []
    for _ in range(12):
        dd = json.loads(get(f"{PUB}/markets/btcusdt/depth?limit=5")[2])
        tops.append((dd["asks"][0][0], dd["bids"][0][0], json.dumps(dd["asks"]) + json.dumps(dd["bids"])))
        stamps.append(dd["timestamp"])
        time.sleep(1)
    changes = sum(1 for a, b in zip(tops, tops[1:]) if a[2] != b[2])
    print("top-5 changes between polls", changes, "of", len(tops) - 1, "timestamp advanced", stamps[-1] - stamps[0], "s")

    print("spread and Binance spot reference, 5 markets")
    for mid, bsym in (("btcusdt", "BTCUSDT"), ("ethusdt", "ETHUSDT"), ("bnbusdt", "BNBUSDT"), ("dogeusdt", "DOGEUSDT"), ("adausdt", "ADAUSDT")):
        dd = json.loads(get(f"{PUB}/markets/{mid}/depth?limit=1")[2])
        ask, bid = float(dd["asks"][0][0]), float(dd["bids"][0][0])
        cs_mid = (ask + bid) / 2
        st, _, body, _ = get(f"/api/v3/ticker/bookTicker?symbol={bsym}", host="api.binance.com")
        if st == 200:
            bt = json.loads(body)
            bmid = (float(bt["askPrice"]) + float(bt["bidPrice"])) / 2
            print(mid, "spread bps", round((ask - bid) / cs_mid * 1e4, 1), "mid vs Binance mid bps", round((cs_mid / bmid - 1) * 1e4, 1))
        else:
            print(mid, "spread bps", round((ask - bid) / cs_mid * 1e4, 1), "Binance", st, body[:80])
        time.sleep(0.3)

    st, _, body, _ = get(f"{PUB}/markets/btcusdt/trades?limit=1000")
    tr = json.loads(body)
    span = (tr[0]["created_at"] - tr[-1]["created_at"]) / 3600 if len(tr) > 1 else 0
    print("trades limit=1000", st, "rows", len(tr), "span hours", round(span, 2), "fields", sorted(tr[0].keys()))
    st, _, body, _ = get(f"{PUB}/markets/btcusdt/trades?limit=1001")
    print("trades limit=1001", st, body[:100])


def limits_and_errors() -> None:
    section("5. rate limits and error shapes")
    statuses = collections.Counter()
    seen = set()
    t0 = time.monotonic()
    for _ in range(20):
        st, h, _, _ = get(f"{PUB}/markets/btcusdt/depth?limit=1")
        statuses[st] += 1
        seen |= {k for k in h if "limit" in k or "retry" in k}
        time.sleep(0.4)
    print("20 depth calls in", round(time.monotonic() - t0, 1), "s statuses", dict(statuses), "rate limit headers", sorted(seen) or "none")
    for path in (f"{PUB}/markets/nosuchusdt/depth", f"{PUB}/markets/btcusdt/order-book?asks_limit=0", f"{PUB}/markets/BTCUSDT/depth?limit=1", f"{PUB}/nosuch", f"{PUB}/version"):
        st, h, body, _ = get(path)
        print("GET", path, st, h.get("content-type"), body[:120])


def server_time() -> None:
    section("6. server time")
    offs = []
    for _ in range(5):
        t0 = time.time()
        st, h, body, rtt = get(f"{PUB}/timestamp")
        mid = t0 + rtt / 2
        server = email.utils.parsedate_to_datetime(h["date"]).timestamp()
        ts = json.loads(body)
        offs.append((round(server - mid, 2), round(datetime.datetime.fromisoformat(ts).timestamp() - mid, 2)))
        time.sleep(0.5)
    print("GET /timestamp body", ts, "offsets s (Date header, body), whole-second resolution", offs)
    st, _, body, _ = get("/api/v2/barong/identity/time")
    print("GET /api/v2/barong/identity/time", st, body, "local", int(time.time()))


def main() -> None:
    host_and_latency()
    catalog()
    no_anchor()
    rest_book()
    limits_and_errors()
    server_time()


if __name__ == "__main__":
    main()
