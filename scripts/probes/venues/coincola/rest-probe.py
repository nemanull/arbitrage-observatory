# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CoinCola public REST probe for docs/profiles/coincola/.

Covers the documented market API on api.coincola.com and the calls the spot trading page makes on www.coincola.com/api.
Read-only and unauthenticated, about 90 requests over about two minutes.
Run from the repository root with: uv run scripts/probes/venues/coincola/rest-probe.py
"""

import collections
import email.utils
import http.client
import json
import re
import socket
import ssl
import statistics
import time
import urllib.parse

UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
API = "api.coincola.com"
WEB = "www.coincola.com"
CTX = ssl.create_default_context()


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


class Conn:
    """One kept-alive HTTPS connection per host, so cold and warm timings can be told apart."""

    def __init__(self, host: str):
        self.host = host
        self.c = None

    def req(self, method: str, path: str, body: str | None = None, fresh: bool = False):
        if fresh or self.c is None:
            if self.c:
                self.c.close()
            self.c = http.client.HTTPSConnection(self.host, timeout=20, context=CTX)
        headers = {"User-Agent": UA, "Accept": "application/json"}
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        t0 = time.monotonic()
        self.c.request(method, path, body=body, headers=headers)
        r = self.c.getresponse()
        data = r.read()
        ms = (time.monotonic() - t0) * 1000
        return r.status, dict((k.lower(), v) for k, v in r.getheaders()), data, ms


def j(data: bytes):
    return json.loads(data)


def hosts() -> None:
    section("1. hosts and latency")
    for h in [API, WEB, "www.coincola.stream"]:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        print(h, addrs)
    for host, path in [(API, "/v1/market/orderbook?market_pair=BTC_USDT&level=1"), (WEB, "/api/exchange/market/category")]:
        c = Conn(host)
        cold = [c.req("GET", path, fresh=True)[3] for _ in range(3)]
        warm = [c.req("GET", path)[3] for _ in range(8)]
        st, hd, _, _ = c.req("GET", path)
        print(f"{host}{path.split('?')[0]} status {st} cold ms {[round(x) for x in cold]} warm ms min {min(warm):.0f} median {statistics.median(warm):.0f} max {max(warm):.0f}")
        print("  headers", {k: hd[k] for k in hd if k in ("server", "cache-control", "via", "x-cache", "x-amz-cf-pop", "cf-ray", "age", "content-encoding")})


def catalog(api: Conn, web: Conn) -> dict:
    section("2. catalog")
    st, hd, data, ms = api.req("GET", "/v1/market")
    rows = j(data)
    print(f"GET /v1/market status {st} rows {len(rows)} bytes {len(data)} ms {ms:.0f} cache-control {hd.get('cache-control')}")
    print("row keys", sorted(rows[0].keys()))
    print("pairs by quote", dict(collections.Counter(r["quote_currency"] for r in rows)))
    ids = sorted(r["trading_pairs"] for r in rows)
    print("ids", ids)
    print("pairs with zero 24h base volume", sorted(r["trading_pairs"] for r in rows if not r["base_volume"]))
    print("pairs with no bid or no ask", sorted(r["trading_pairs"] for r in rows if not r["highest_bid"] or not r["lowest_ask"]))
    st, hd, data, ms = api.req("GET", "/v1/market/ticker")
    tick = j(data)
    print(f"GET /v1/market/ticker status {st} pairs {len(tick)} is_frozen counts {dict(collections.Counter(v['is_frozen'] for v in tick.values()))}")
    print("ticker ids equal /v1/market ids", sorted(tick) == ids, "only in ticker", sorted(set(tick) - set(ids)), "only in market", sorted(set(ids) - set(tick)))
    print("ticker pairs with last_price 0", sorted(k for k, v in tick.items() if not v["last_price"]))
    print("ticker pairs with is_frozen 1", sorted(k for k, v in tick.items() if v["is_frozen"]))
    st, hd, data, ms = api.req("GET", "/v1/market/assets")
    assets = j(data)
    print(f"GET /v1/market/assets status {st} assets {len(assets)}")

    # the trading page embeds the web client's symbol table in __NEXT_DATA__
    st, hd, data, ms = web.req("GET", "/trading/btc/usdt")
    html = data.decode("utf-8", "replace")
    nd = json.loads(re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html).group(1))
    em = nd["props"]["initialMobxState"]["tradingStore"]["assetInfo"]["exchange_market"]
    syms = em["symbols"]
    print(f"trading page status {st} bytes {len(data)} exchange_market quotes {em['quotes']} symbols {len(syms)}")
    print("quote_symbols", {q: len(v) for q, v in em["quote_symbols"].items()})
    print("page symbols equal /v1/market ids", sorted(syms) == ids, "only on page", sorted(set(syms) - set(ids)), "only in API", sorted(set(ids) - set(syms)))
    print("BTC_USDT entry", json.dumps(syms.get("BTC_USDT")))
    print("ETH_BTC entry", json.dumps(syms.get("ETH_BTC")))
    print("margin_support true on", sorted(k for k, v in syms.items() if v.get("margin_support")), "leverage values", dict(collections.Counter(v.get("leverage") for v in syms.values())))
    print("order_type values", dict(collections.Counter(tuple(v.get("order_type", [])) for v in syms.values())))
    m = re.search(r"Fee: [0-9.]+%", html)
    print("fee text on the trading page", m.group(0) if m else None)
    for q in em["quotes"]:
        st, hd, data, ms = web.req("POST", "/api/exchange/market/ticker/list", body=urllib.parse.urlencode({"currency": q}))
        t = j(data)["data"]["tickers"]
        print(f"POST /api/exchange/market/ticker/list currency={q} status {st} tickers {len(t)}")
    return {"ids": ids, "tick": tick}


def anchor(api: Conn, web: Conn) -> None:
    section("3. anchor: the documented derivatives calls, and the web price calls")
    for pt in ["PERPETUAL", "FUTURES", "OPTIONS"]:
        st, hd, data, ms = api.req("GET", f"/v1/contract/market?product_type={pt}")
        print(f"GET /v1/contract/market?product_type={pt} status {st} body {data.decode()[:200]}")
    st, hd, data, ms = api.req("GET", "/v1/contract/market/specifications?product_type=PERPETUAL&ticker_id=BTC_PERPUSDT")
    print("specifications BTC_PERPUSDT", st, data.decode()[:200])
    st, hd, data, ms = api.req("GET", "/v1/contract/market/orderbook?product_type=PERPETUAL&ticker_id=BTC_PERPUSDT&depth=10")
    print("contract orderbook BTC_PERPUSDT", st, data.decode()[:200])
    st, hd, data, ms = api.req("GET", "/v1/contract/market")
    print("contract market without product_type", st, data.decode()[:200])
    st, hd, data, ms = web.req("POST", "/api/exchange/market/currency/price", body="quote_currency=USDT")
    print("POST /api/exchange/market/currency/price quote_currency=USDT", st, data.decode()[:300])


def book(api: Conn, web: Conn) -> None:
    section("5. REST book")
    for depth in [0, 10, 20, 50, 100, 400, 1000]:
        st, hd, data, ms = api.req("GET", f"/v1/market/orderbook?market_pair=BTC_USDT&level=2&depth={depth}")
        if st != 200:
            print(f"depth {depth} status {st} body {data.decode()[:200]}")
            continue
        d = j(data)
        a, b = d["asks"], d["bids"]
        print(f"depth {depth}: asks {len(a)} bids {len(b)} bytes {len(data)} asks ascending {[x[0] for x in a] == sorted(x[0] for x in a)} bids descending {[x[0] for x in b] == sorted((x[0] for x in b), reverse=True)} keys {sorted(d)}")
    st, hd, data, ms = api.req("GET", "/v1/market/orderbook?market_pair=BTC_USDT&level=1")
    print("level 1", st, data.decode()[:250])
    st, hd, data, ms = api.req("GET", "/v1/market/orderbook?market_pair=BTC_USDT&level=2")
    d = j(data)
    print(f"no depth: asks {len(d['asks'])} bids {len(d['bids'])} bytes {len(data)}")
    st, hd, data, ms = api.req("GET", "/v1/market/orderbook?market_pair=ETH_BTC&level=2&depth=20")
    print("ETH_BTC depth 20", st, data.decode()[:300])
    print("cache headers", {k: hd.get(k) for k in ("cache-control", "age", "x-cache", "etag", "last-modified")})
    st, hd, data, ms = web.req("POST", "/api/exchange/market/depth", body="levels=20&price_precision=2&symbol=BTC_USDT")
    d = j(data)["data"]
    print(f"web POST /api/exchange/market/depth status {st} asks {len(d['asks'])} bids {len(d['bids'])} level shape {d['asks'][0]} echo levels {d.get('levels')} precision {d.get('price_precision')}")

    print("30 one-second polls of depth=10 on BTC_USDT")
    prev, changes, ts, offsets = None, 0, [], []
    for _ in range(30):
        t_local = time.time() * 1000
        st, hd, data, ms = api.req("GET", "/v1/market/orderbook?market_pair=BTC_USDT&level=2&depth=10")
        d = j(data)
        offsets.append(d["timestamp"] - (t_local + ms / 2))
        body = (d["asks"], d["bids"])
        if prev is not None and body != prev:
            changes += 1
        prev = body
        ts.append(d["timestamp"])
        time.sleep(1)
    steps = [b - a for a, b in zip(ts, ts[1:])]
    print(f"book changed on {changes} of 29 polls, timestamp step ms median {statistics.median(steps):.0f} min {min(steps)} max {max(steps)}")
    print(f"timestamp minus local midpoint ms: median {statistics.median(offsets):.0f} min {min(offsets):.0f} max {max(offsets):.0f}")


def limits_errors(api: Conn) -> None:
    section("6. rate limit headers, a short burst, and error shapes")
    statuses = collections.Counter()
    seen_headers = set()
    t0 = time.monotonic()
    for _ in range(20):
        st, hd, data, ms = api.req("GET", "/v1/market/orderbook?market_pair=ETH_USDT&level=2&depth=10")
        statuses[st] += 1
        seen_headers |= {k for k in hd if "rate" in k or "limit" in k or "retry" in k}
        time.sleep(0.2)
    print(f"20 requests in {time.monotonic() - t0:.1f} s statuses {dict(statuses)} rate headers {sorted(seen_headers)}")
    for path in [
        "/v1/market/orderbook?market_pair=NOPE_USDT&level=2&depth=10",
        "/v1/market/orderbook?level=2",
        "/v1/market/orderbook?market_pair=BTC_USDT",
        "/v1/market/orderbook?market_pair=btc_usdt&level=2&depth=10",
        "/v1/market/orderbook?market_pair=BTC_USDT&level=2&depth=15",
        "/v1/market/trade?market_pair=BTC_USDT&limit=2000",
        "/v1/nope",
    ]:
        st, hd, data, ms = api.req("GET", path)
        print(f"{path} status {st} body {data.decode()[:200]}")
    web = Conn(WEB)
    web.c = http.client.HTTPSConnection(WEB, timeout=20, context=CTX)
    web.c.request("POST", "/api/exchange/market/ticker/list", body=json.dumps({"currency": "USDT"}), headers={"User-Agent": UA, "Content-Type": "application/json"})
    r = web.c.getresponse()
    print(f"web ticker/list with a JSON body status {r.status} body {r.read().decode()[:120]}")


def server_time(api: Conn) -> None:
    section("7. server time")
    for path in ["/v1/time", "/v1/common/time", "/v1/market/time"]:
        st, hd, data, ms = api.req("GET", path)
        print(path, st, data.decode()[:120])
    st, hd, data, ms = api.req("GET", "/v1/market/trade?market_pair=BTC_USDT&limit=1")
    local = time.time()
    date = email.utils.parsedate_to_datetime(hd["date"]).timestamp()
    print(f"Date header minus local s {date - local:.1f}, newest trade timestamp {j(data)[0]['timestamp']}")


def main() -> None:
    print("probe start UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    hosts()
    api, web = Conn(API), Conn(WEB)
    catalog(api, web)
    anchor(api, web)
    book(api, web)
    limits_errors(api)
    server_time(api)
    print("\nprobe end UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
