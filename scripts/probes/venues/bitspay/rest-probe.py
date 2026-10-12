# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of the Bitspay public REST API at apiv2.bitspay.io.

It measures latency, reads the spot catalog and tickers, inspects the REST book, the trade list and error shapes, and polls one book every two seconds for about a minute.
About 50 GET requests in total, spaced at least half a second apart.

Run with: uv run scripts/probes/venues/bitspay/rest-probe.py
"""

import email.utils
import http.client
import json
import socket
import ssl
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

HOST = "apiv2.bitspay.io"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe"}
WORK = Path(__file__).resolve().parents[4] / ".claude" / "survey-work" / "bitspay"
PAIR = "BTC_USDT"
LIMIT_HEADERS = Counter()
STATUSES = Counter()


def log(*a):
    print(*a, flush=True)


def get(path: str, host: str = HOST):
    url = f"https://{host}/{path}"
    req = urllib.request.Request(url, headers=UA)
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            status, headers = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, dict(e.headers)
    ms = (time.monotonic() - t0) * 1000
    if host == HOST:
        STATUSES[status] += 1
        for k in headers:
            if "ratelimit" in k.lower() or "retry" in k.lower() or "x-rate" in k.lower():
                LIMIT_HEADERS[k.lower()] += 1
    time.sleep(0.5)
    return status, headers, body, ms


def jget(path: str, host: str = HOST):
    status, headers, body, ms = get(path, host)
    try:
        data = json.loads(body)
    except Exception:
        data = None
    return status, headers, data, body, ms


def section(t):
    log(f"\n== {t}")


def latency():
    section("1. host and latency")
    for h in [HOST, "www.bitspay.io", "socket.bitspay.io", "node.bitspay.io", "api.bitspay.io"]:
        addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        log(f"{h} resolves to {addrs}")
    ctx = ssl.create_default_context()
    t0 = time.monotonic()
    conn = http.client.HTTPSConnection(HOST, timeout=20, context=ctx)
    conn.request("GET", "/info", headers=UA)
    r = conn.getresponse()
    r.read()
    cold = (time.monotonic() - t0) * 1000
    warm = []
    for _ in range(5):
        time.sleep(0.5)
        t1 = time.monotonic()
        conn.request("GET", "/info", headers=UA)
        r = conn.getresponse()
        r.read()
        warm.append((time.monotonic() - t1) * 1000)
    conn.close()
    warm.sort()
    log(f"GET /info cold (TCP, TLS, request) {cold:.0f} ms, warm on the same connection min {warm[0]:.0f} median {warm[2]:.0f} max {warm[-1]:.0f} ms")
    log(f"edge headers: server={r.headers.get('server')} cf-ray={r.headers.get('cf-ray')} x-powered-by={r.headers.get('x-powered-by')}")


def catalog():
    section("2. catalog")
    s, h, info, _, _ = jget("info")
    log(f"info status {s}: capability {json.dumps(info.get('capability'))}, location {info.get('location')!r}")
    s, h, mk, _, ms = jget("markets/")
    markets = mk["combinations"]
    log(f"markets/ status {s}, {len(markets)} rows in {ms:.0f} ms, by quote {dict(Counter(m['quote'] for m in markets))}")
    s, h, pr, _, _ = jget("getavailablepairs/")
    pairs = pr["combinations"]
    log(f"getavailablepairs/ status {s}, {len(pairs)} ids, same set as markets/: {set(pairs) == {m['id'] for m in markets}}")
    s, h, cg, _, _ = jget("coingecko/pairs")
    cgp = cg["supportedcombinations"]
    same = {r["ticker_id"] for r in cgp} == {m["id"] for m in markets}
    log(f"coingecko/pairs status {s}, {len(cgp)} rows, same set as markets/: {same}")
    s, h, tk, body, ms = jget("ticker/all")
    tick = tk["marketdetails"]
    log(f"ticker/all status {s}, {len(tick)} rows, {len(body)} bytes in {ms:.0f} ms, market_type {dict(Counter(t.get('market_type') for t in tick))}")
    s, h, cm, _, _ = jget("getCompleteMarkets/")
    comp = cm["marketdetails"]
    log(f"getCompleteMarkets/ status {s}, {len(comp)} rows, market_type {dict(Counter(t.get('market_type') for t in comp))}")
    ids = {m["id"] for m in markets}
    tids = {t["pair"] for t in tick}
    cids = {t["pair"] for t in comp}
    log(f"catalog ids without a ticker/all row: {sorted(ids - tids)}")
    log(f"getCompleteMarkets/ pairs not in markets/: {sorted(cids - ids)}")
    log(f"ticker/all keys: {sorted(tick[0].keys())}")
    zero = [t["pair"] for t in comp if float(t.get("baseVolume") or 0) == 0]
    log(f"getCompleteMarkets/ rows with zero baseVolume: {len(zero)}")
    crossed = [t["pair"] for t in tick if float(t["bid"]) > float(t["ask"])]
    equal = [t["pair"] for t in tick if float(t["bid"]) == float(t["ask"])]
    log(f"ticker/all rows with bid above ask: {len(crossed)} of {len(tick)}, bid equal to ask: {len(equal)}")
    bt = next(t for t in tick if t["pair"] == PAIR)
    log(f"ticker/all {PAIR}: last {bt['last']} bid {bt['bid']} ask {bt['ask']} updated_at {bt.get('updated_at')} baseVolume {bt['baseVolume']} quoteVolume {bt['quoteVolume']}")
    return tick


def book(tick):
    section("5. REST book")
    s, h, ob, body, ms = jget(f"orderbook/{PAIR}")
    a, b = ob["asks"], ob["bids"]
    ap = [float(x["price"]) for x in a]
    bp = [float(x["price"]) for x in b]
    log(f"orderbook/{PAIR} status {s}, {len(body)} bytes in {ms:.0f} ms, keys {list(ob.keys())}, {len(a)} asks, {len(b)} bids")
    log(f"  asks ascending {ap == sorted(ap)}, bids descending {bp == sorted(bp, reverse=True)}, duplicate prices {len(ap) - len(set(ap)) + len(bp) - len(set(bp))}")
    spread = (min(ap) - max(bp)) / min(ap) * 1e4
    log(f"  best bid {b[0]['price']} best ask {a[0]['price']}, spread {spread:.1f} bps, crossed {max(bp) >= min(ap)}, deepest ask {a[-1]['price']} deepest bid {b[-1]['price']}")
    log(f"  level shape {json.dumps(a[0])}, last field {ob.get('last')!r}, ticker_id {ob.get('ticker_id')!r}")
    log(f"  cache headers: etag {h.get('etag') or h.get('ETag')}, cf-cache-status {h.get('cf-cache-status') or h.get('Cf-Cache-Status')}, cache-control {h.get('cache-control')}")
    s, h, dp, body2, _ = jget(f"depth/{PAIR}")
    log(f"depth/{PAIR} status {s}, byte identical to orderbook/: {body2 == body}")
    s, h, ob10, _, _ = jget(f"orderbook/{PAIR}?depth=10")
    log(f"orderbook/{PAIR}?depth=10: {len(ob10['asks'])} asks, {len(ob10['bids'])} bids")
    for d in [20, 100, 1000]:
        s, h, cg, _, _ = jget(f"coingecko/orderbook?ticker_id={PAIR}&depth={d}")
        log(f"coingecko/orderbook depth={d}: status {s}, {len(cg.get('asks', []))} asks, {len(cg.get('bids', []))} bids, keys {list(cg.keys())}")
    s, h, raw, body3, _ = jget(f"getOrderBook/{PAIR}")
    rows = raw["orderbook"]
    log(f"getOrderBook/{PAIR} status {s}, {len(rows)} individual orders, {len(body3)} bytes, types {dict(Counter(r['ordertype'] for r in rows))}, row {json.dumps(rows[0])}")
    bt = next(t for t in tick if t["pair"] == PAIR)
    log(f"ticker/all bid {bt['bid']} ask {bt['ask']} against book best bid {b[0]['price']} best ask {a[0]['price']}")
    thin = "OMG_BNB"
    s, h, ot, _, _ = jget(f"orderbook/{thin}")
    log(f"orderbook/{thin}: status {s}, {len(ot.get('asks', []))} asks, {len(ot.get('bids', []))} bids")
    for bad in ["orderbook/FOO_BAR", "getSelectedMarket/FOO_BAR", "coingecko/orderbook?ticker_id=FOO_BAR&depth=10", "orderbook/btc_usdt", "nosuchpath"]:
        s, h, _, body, _ = jget(bad)
        log(f"unknown or malformed {bad}: status {s}, body {body[:160]!r}")


def trades():
    section("trades")
    s, h, tr, body, _ = jget(f"trades/{PAIR}")
    rows = tr["orderbook"]
    t0 = rows[0]
    log(f"trades/{PAIR} status {s}, {len(rows)} rows, newest {t0['time']}, oldest {rows[-1]['time']}")
    log(f"  newest row {json.dumps(t0)}")
    p = float(t0["price"])
    log(f"  price times baseVolume {p * float(t0['baseVolume']):.4f}, price times quoteVolume {p * float(t0['quoteVolume']):.4f}, so quoteVolume holds the base amount: {abs(p * float(t0['quoteVolume']) - float(t0['baseVolume'])) < 1e-6 * float(t0['baseVolume'])}")


def reference_and_clock():
    section("7. clock and reference")
    s, h, _, _, _ = jget("info")
    local = time.time()
    server = email.utils.parsedate_to_datetime(h.get("Date") or h.get("date")).timestamp()
    log(f"no server time call is documented, the Date header reads {h.get('Date') or h.get('date')}, offset against local clock {server - local:+.1f} s at one second resolution")
    s, h, kr, _, _ = jget("0/public/Ticker?pair=XBTUSDT", host="api.kraken.com")
    k = kr["result"]["XBTUSDT"]
    kmid = (float(k["a"][0]) + float(k["b"][0])) / 2
    s, h, ob, _, _ = jget(f"coingecko/orderbook?ticker_id={PAIR}&depth=2")
    bmid = (float(ob["asks"][0]["price"]) + float(ob["bids"][0]["price"])) / 2
    log(f"reference: Kraken XBTUSDT mid {kmid:.2f}, Bitspay {PAIR} mid {bmid:.2f}, difference {(bmid - kmid) / kmid * 1e4:+.1f} bps")


def poll():
    section("4. one minute of two second polls of two book paths")
    paths = {"orderbook": f"orderbook/{PAIR}?depth=20", "coingecko": f"coingecko/orderbook?ticker_id={PAIR}&depth=20"}
    seen = {k: [] for k in paths}
    slow = []
    t_end = time.monotonic() + 60
    while time.monotonic() < t_end:
        t0 = time.monotonic()
        for k, path in paths.items():
            s, h, ob, body, ms = jget(path)
            slow.append(ms)
            if s != 200 or not ob or "asks" not in ob:
                log(f"{k} poll status {s} body {body[:160]!r}")
                continue
            seen[k].append((ob["bids"][0]["price"], ob["asks"][0]["price"], json.dumps(ob["asks"] + ob["bids"]), ob.get("last")))
        time.sleep(max(0, 2 - (time.monotonic() - t0)))
    for k, v in seen.items():
        tops = sum(1 for i in range(1, len(v)) if v[i][:2] != v[i - 1][:2])
        books = sum(1 for i in range(1, len(v)) if v[i][2] != v[i - 1][2])
        lasts = sum(1 for i in range(1, len(v)) if v[i][3] != v[i - 1][3])
        log(f"{k}: {len(v)} polls, top of book changed {tops} times, the 20 level book changed {books} times, last changed {lasts} times, first top {v[0][:2]}, final top {v[-1][:2]}")
    same = sum(1 for a, b in zip(seen["orderbook"], seen["coingecko"]) if a[2] == b[2])
    slow.sort()
    log(f"polls where both paths returned the same 20 levels: {same} of {min(len(seen['orderbook']), len(seen['coingecko']))}")
    log(f"poll latency min {slow[0]:.0f} median {slow[len(slow) // 2]:.0f} max {slow[-1]:.0f} ms")


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    latency()
    tick = catalog()
    book(tick)
    trades()
    reference_and_clock()
    poll()
    section("6. rate limits")
    log(f"statuses from {HOST} over this run: {dict(STATUSES)}, requests {sum(STATUSES.values())}")
    log(f"rate limit or Retry-After headers seen: {dict(LIMIT_HEADERS) or 'none'}")


if __name__ == "__main__":
    main()
