# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Ripio Trade public REST probe, read-only and unauthenticated.

Every path comes from the v4 API documentation at https://apidocs.ripiotrade.co/.
The documentation says public endpoints carry a cache of up to 30 seconds and a reduced limit, and an unverified account gets 1 request per second.
This probe never sends more than one request per second.

Run from the repository root: uv run scripts/probes/venues/ripio/rest-probe.py [mode]
Modes:
  access   DNS, cold and warm request times, the documentation host, the retired CCXT host
  catalog  pairs, currencies, countries and tickers, with the pairs counted by quote and country
  book     the level 2 and level 3 books, their depth and level order, the limit parameter, and error shapes
  cache    about 60 s of level 2 polls on BTC_USDC every 2 s, to see how often the reply changes
  time     server time and clock offset
  all      every mode above in turn (the default)
"""

import collections
import hashlib
import json
import socket
import sys
import time
import urllib.error
import urllib.request

API = "https://api.ripiotrade.co/v4"
UA = "arbitrage-observatory venue survey probe"
WATCH_HEADERS = ("Server", "CF-Cache-Status", "Age", "Cache-Control", "Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "RateLimit-Limit", "RateLimit-Remaining", "Content-Type")


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body, status, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        body, status, hdrs = e.read(), e.code, e.headers
    except (urllib.error.URLError, OSError) as e:
        return None, {}, str(e).encode(), (time.perf_counter() - t0) * 1000
    return status, {k: hdrs.get(k) for k in WATCH_HEADERS if hdrs.get(k) is not None}, body, (time.perf_counter() - t0) * 1000


def short(body, n=300):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def paced(seconds=1.1):
    time.sleep(seconds)


def access():
    print("\n=== access")
    for host in ("api.ripiotrade.co", "ws.ripiotrade.co", "apidocs.ripiotrade.co", "trade.ripio.com", "api.exchange.ripio.com"):
        try:
            addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"no address: {e}"]
        print(f"DNS {host}: {addrs}")
    for i in range(4):
        status, hdrs, body, ms = get(f"{API}/public/server-time")
        print(f"server-time request {i + 1}: {status} {ms:.0f} ms {hdrs} {short(body, 120)}")
        paced()
    for url in ("https://apidocs.ripiotrade.co/", "https://apidocs.ripiotrade.co/v4", "https://apidocs.ripiotrade.co/v3/", "https://trade.ripio.com/", "https://api.exchange.ripio.com/api/v1/pair/"):
        status, hdrs, body, ms = get(url)
        print(f"GET {url}: {status} {len(body)} bytes {ms:.0f} ms {short(body, 140)!r}")
        paced()


def catalog():
    print("\n=== catalog")
    status, hdrs, body, ms = get(f"{API}/public/pairs")
    pairs = json.loads(body)["data"]
    print(f"GET /public/pairs: {status} {len(body)} bytes {ms:.0f} ms headers {hdrs}")
    print(f"{len(pairs)} pairs, {sum(p['enabled'] for p in pairs)} enabled")
    print("by quote:", dict(collections.Counter(p["quote"] for p in pairs)))
    print("fields:", sorted(pairs[0]))
    usd_family = [p["symbol"] for p in pairs if p["quote"] in ("USD", "USDC", "USDT")]
    print(f"quoted in USD, USDC or USDT: {len(usd_family)}: {usd_family}")
    by_country = collections.Counter(c for p in pairs for c in p["countries"])
    print("pairs offered per country:", dict(by_country))
    for p in pairs:
        print(f"  {p['symbol']:<12} enabled={p['enabled']} price_tick={p['price_tick']} amount_tick={p['amount_tick']} min_amount={p['min_amount']} min_value={p['min_value']} countries={','.join(p['countries'])}")
    paced()
    status, hdrs, body, ms = get(f"{API}/public/pairs?countries=BR")
    print(f"GET /public/pairs?countries=BR: {status} {len(json.loads(body)['data']) if status == 200 else short(body)} pairs {ms:.0f} ms")
    paced()
    status, hdrs, body, ms = get(f"{API}/public/countries")
    print(f"GET /public/countries: {status} {ms:.0f} ms {short(body, 400)}")
    paced()
    status, hdrs, body, ms = get(f"{API}/public/currencies")
    cur = json.loads(body)["data"]
    print(f"GET /public/currencies: {status} {len(body)} bytes {ms:.0f} ms, {len(cur)} currencies, {sum(c['active'] for c in cur)} active")
    paced()
    status, hdrs, body, ms = get(f"{API}/public/tickers")
    tick = json.loads(body)["data"]
    print(f"GET /public/tickers: {status} {len(body)} bytes {ms:.0f} ms headers {hdrs}, {len(tick)} rows, fields {sorted(tick[0])}")
    for t in sorted(tick, key=lambda t: t["pair"]):
        spread = (t["ask"] - t["bid"]) / ((t["ask"] + t["bid"]) / 2) * 1e4 if t["ask"] and t["bid"] else None
        print(f"  {t['pair']:<12} bid={t['bid']} ask={t['ask']} spread_bps={spread:.1f} volume={t['volume']} quote_volume={t['quote_volume']} trades={t['trades_quantity']} frozen={t['is_frozen']} date={t['date']}")
    keys = set().union(*(set(t) for t in tick))
    print("any index, mark or funding field in tickers:", sorted(k for k in keys if any(w in k for w in ("index", "mark", "fund"))))


def book():
    print("\n=== book")
    for path in ("/public/orders/level-2?pair=BTC_USDC", "/public/orders/level-2?pair=BTC_USDC&limit=20", "/public/orders/level-2?pair=BTC_USDC&limit=max", "/public/orders/level-2?pair=USDT_ARS&limit=max", "/public/orders/level-3?pair=BTC_USDC"):
        status, hdrs, body, ms = get(API + path)
        d = json.loads(body)
        data = d.get("data") or {}
        bids, asks = data.get("bids", []), data.get("asks", [])
        bp, ap = [lv["price"] for lv in bids], [lv["price"] for lv in asks]
        print(f"GET {path}: {status} {len(body)} bytes {ms:.0f} ms headers {hdrs}")
        print(f"  keys {sorted(data)}, bids {len(bids)}, asks {len(asks)}, bids descending {all(a > b for a, b in zip(bp, bp[1:]))}, asks ascending {all(a < b for a, b in zip(ap, ap[1:]))}, level fields {sorted(bids[0]) if bids else None}")
        print(f"  best bid {bids[0] if bids else None}, best ask {asks[0] if asks else None}, timestamp {data.get('timestamp')}, hash {data.get('hash')}")
        paced()
    for path in ("/public/orders/level-2?pair=NOPE_USDC", "/public/orders/level-2", "/public/orders/level-2?pair=BTC_USDC&limit=0", "/public/nope", "/public/tickers/NOPE_USDC"):
        status, hdrs, body, ms = get(API + path)
        print(f"GET {path}: {status} {ms:.0f} ms {short(body, 300)}")
        paced()


def cache():
    print("\n=== cache")
    seen = []
    t0 = time.time()
    while time.time() - t0 < 60:
        status, hdrs, body, ms = get(f"{API}/public/orders/level-2?pair=BTC_USDC&limit=20")
        data = json.loads(body).get("data") or {}
        digest = hashlib.sha1(json.dumps([data.get("bids"), data.get("asks")]).encode()).hexdigest()[:10]
        seen.append((time.time() - t0, digest, data.get("timestamp"), data.get("hash")))
        print(f"+{time.time() - t0:5.1f}s {status} {ms:4.0f} ms book {digest} timestamp {data.get('timestamp')} hash {data.get('hash')} cf {hdrs.get('CF-Cache-Status')} age {hdrs.get('Age')}")
        time.sleep(2)
    changes = sum(1 for a, b in zip(seen, seen[1:]) if a[1] != b[1])
    print(f"{len(seen)} polls, the book changed {changes} times, {len({s[1] for s in seen})} distinct books")
    stamps = [s[2] for s in seen if s[2]]
    if stamps:
        lags = [(s[0] + t0) * 1000 - s[2] for s in seen if s[2]]
        print(f"reply timestamp lag behind local clock: min {min(lags) / 1000:.1f}s, max {max(lags) / 1000:.1f}s")


def server_time():
    print("\n=== time")
    for _ in range(3):
        t_send = time.time() * 1000
        status, hdrs, body, ms = get(f"{API}/public/server-time")
        t_recv = time.time() * 1000
        ts = json.loads(body)["data"]["timestamp"]
        print(f"{status} server {ts}, local midpoint {(t_send + t_recv) / 2:.0f}, offset {ts - (t_send + t_recv) / 2:+.0f} ms, round trip {ms:.0f} ms")
        paced()


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"Ripio REST probe, mode {mode}, started {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    for name, fn in (("access", access), ("catalog", catalog), ("book", book), ("cache", cache), ("time", server_time)):
        if mode in (name, "all"):
            fn()


main()
