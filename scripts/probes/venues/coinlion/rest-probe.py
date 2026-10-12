# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CoinLion spot REST probe for docs/profiles/coinlion/rest.md.

Public, unauthenticated and read-only.
It sends about 210 requests to ursa.coinlion.com over about two and a half minutes, never more than one at a time.
CoinLion publishes no API documentation and no rate limit, so the probe keeps at least half a second between requests.
Run from the repository root with: uv run scripts/probes/venues/coinlion/rest-probe.py
"""

import collections
import email.utils
import json
import socket
import statistics
import time
import urllib.error
import urllib.request

HOST = "ursa.coinlion.com"
MD = f"https://{HOST}/marketdata"
FO = f"https://{HOST}/frontoffice-v2/api/v2"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
GAP = 0.5


def get(url, method="GET"):
    """Return status, lower-cased headers, body text and elapsed ms, without raising on HTTP errors."""
    req = urllib.request.Request(url, headers=UA, method=method, data=b"" if method == "POST" else None)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            status, headers = r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        status, headers = e.code, {k.lower(): v for k, v in e.headers.items()}
    ms = (time.perf_counter() - t0) * 1000
    headers["x-probe-local-mid"] = time.time() - ms / 2000
    time.sleep(GAP)
    return status, headers, body, ms


def section(name):
    print(f"\n=== {name}")


def host_and_latency():
    section("1. host and latency")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    print("resolved", addrs)
    times = []
    for i in range(6):
        status, headers, body, ms = get(f"{MD}/instruments")
        times.append(ms)
        if i == 0:
            print("first", status, "bytes", len(body), "server", headers.get("server"), "x-cache", headers.get("x-cache"), "pop", headers.get("x-amz-cf-pop"))
    print("cold ms", round(times[0]), "warm median ms", round(statistics.median(times[1:])), "warm all", [round(t) for t in times[1:]])
    status, headers, body, ms = get(f"https://{HOST}/")
    print("root", status, repr(body[:40]))


def catalog():
    section("2. catalog")
    status, headers, body, ms = get(f"{MD}/instruments")
    ids = json.loads(body)
    print("instruments status", status, "count", len(ids), "distinct", len(set(ids)), "ms", round(ms))
    quotes = collections.Counter(i.split("_")[1] for i in ids)
    print("by quote", dict(quotes.most_common()))
    print("every id lowercase base_quote", all(i == i.lower() and i.count("_") == 1 for i in ids))
    for path in ["markets/basic", "assets", "assets/prices"]:
        status, headers, body, ms = get(f"{FO}/{path}")
        print(f"frontoffice {path}", status, body[:120])
    status, headers, body, ms = get(f"{FO}/countries")
    rows = json.loads(body) if status == 200 else []
    print("frontoffice countries", status, "rows", len(rows), "active", sum(1 for r in rows if r.get("isActive")), "has US", any(r["id"] == "US" for r in rows), "has CA", any(r["id"] == "CA" for r in rows))
    for path in ["instruments/btc_usd", "instruments/btc_usd/ticker", "instruments/btc_usd/trades", "instruments/btc_usd/orderbook", "markets", "info"]:
        status, headers, body, ms = get(f"{MD}/{path}")
        print(f"marketdata {path}", status, repr(body[:60]))
    return ids


def books(ids):
    section("5. REST book snapshot, every instrument once")
    kinds = collections.Counter()
    two_sided = []
    order_ok = {"bids ascending": 0, "asks ascending": 0, "checked bids": 0, "checked asks": 0}
    crossed = []
    sizes = []
    for i in sorted(ids):
        status, headers, body, ms = get(f"{MD}/instruments/{i}/depth")
        if status != 200:
            kinds[f"status {status}"] += 1
            continue
        d = json.loads(body)
        b, a = d["bids"], d["asks"]
        kind = "two-sided" if b and a else "bids only" if b else "asks only" if a else "empty"
        kinds[kind] += 1
        if kind in ("bids only", "asks only"):
            print("one-sided", i, kind, "levels", len(b) + len(a), "version", d["version"])
        sizes.append(len(body))
        if len(b) > 1:
            order_ok["checked bids"] += 1
            order_ok["bids ascending"] += [x["price"] for x in b] == sorted(x["price"] for x in b)
        if len(a) > 1:
            order_ok["checked asks"] += 1
            order_ok["asks ascending"] += [x["price"] for x in a] == sorted(x["price"] for x in a)
        if b and a:
            best_bid, best_ask = max(x["price"] for x in b), min(x["price"] for x in a)
            two_sided.append((i, len(b), len(a), best_bid, best_ask, d["version"]))
            if best_bid >= best_ask:
                crossed.append(i)
    print("book kinds", dict(kinds))
    print("level order", order_ok)
    print("crossed", crossed)
    print("largest reply bytes", max(sizes), "median", statistics.median(sizes))
    for row in two_sided:
        print("two-sided", row)
    status, headers, body, ms = get(f"{MD}/instruments/btc_usd/depth")
    d = json.loads(body)
    print("btc_usd keys", sorted(d), "bids", [(x["price"], x["amount"]) for x in d["bids"]], "asks", len(d["asks"]), "snapshot", d["snapshot"])
    for q in ["?depth=5", "?limit=5"]:
        status, headers, body, ms = get(f"{MD}/instruments/lion_usdc/depth{q}")
        d = json.loads(body)
        print(f"lion_usdc depth{q}", status, "asks", len(d["asks"]))
    status, headers, body, ms = get(f"{MD}/instruments/nope_xyz/depth")
    print("unknown instrument depth", status, repr(body[:200]))
    print("cache headers", {k: headers.get(k) for k in ["cache-control", "age", "x-cache", "etag"]})


def history():
    section("4. history call")
    end = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime())
    start = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 7 * 86400))
    for i, kind in [("lion_usdc", "1d"), ("sol_usd", "1d"), ("sol_usd", "1h"), ("btc_usd", "1d")]:
        status, headers, body, ms = get(f"{MD}/instruments/{i}/history?startDate={start}&endDate={end}&type={kind}&count=3")
        print(i, kind, status, body[:300])
    status, headers, body, ms = get(f"{MD}/instruments/sol_usd/history")
    print("no dates", status, body[:200])


def version_polls(seconds=30):
    section("4b. lion_usdc and sol_usd depth version over one second polls")
    seen = collections.defaultdict(list)
    t_end = time.time() + seconds
    while time.time() < t_end:
        for i in ["lion_usdc", "sol_usd"]:
            status, headers, body, ms = get(f"{MD}/instruments/{i}/depth")
            d = json.loads(body)
            seen[i].append((d["version"], len(d["bids"]), len(d["asks"])))
    for i, rows in seen.items():
        print(i, "polls", len(rows), "distinct versions", len({r[0] for r in rows}), "first", rows[0], "last", rows[-1])


def limits_and_time():
    section("6 and 7. rate limit headers, errors and server time")
    status, headers, body, ms = get(f"{MD}/instruments/lion_usdc/depth")
    print("rate headers", {k: v for k, v in headers.items() if "rate" in k or "limit" in k or "retry" in k})
    offsets = []
    for _ in range(5):
        status, headers, body, ms = get(f"{MD}/instruments")
        server = email.utils.parsedate_to_datetime(headers["date"]).timestamp()
        offsets.append(server - headers["x-probe-local-mid"])
    print("date header", headers["date"], "offsets s (server minus local, the header has 1 s resolution)", [round(o, 2) for o in offsets])
    status, headers, body, ms = get(f"{FO}/markets/basic")
    print("401 shape", status, headers.get("content-type"), body)
    status, headers, body, ms = get(f"{MD}/instruments/btc_usd/history?startDate=x&endDate=y")
    print("400 shape", status, body[:200])
    status, headers, body, ms = get(f"https://{HOST}/marketdata/info/negotiate?negotiateVersion=1", method="POST")
    print("signalr negotiate", status, body[:300])


if __name__ == "__main__":
    print("started UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    host_and_latency()
    ids = catalog()
    history()
    books(ids)
    version_polls()
    limits_and_time()
    print("\nfinished UTC", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
