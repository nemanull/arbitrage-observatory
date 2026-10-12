# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Cryptomus public REST probe, read-only and unauthenticated.

The market calls come from https://doc.cryptomus.com/methods/market-cap/tickers and its sibling pages, from the WebSocket page https://doc.cryptomus.com/methods/exchange/websockets, and from the trading web app at https://cryptomus.com/exchange/trading, whose bundles name https://exchange-ws.cryptomus.com.

Run from the repository root: uv run scripts/probes/venues/cryptomus/rest-probe.py
It sends about 50 requests over about 70 seconds, one at a time.
Cryptomus publishes no public rate limit, so the probe stays near one request per second.
"""

import collections
import email.utils
import http.client
import json
import socket
import time
import urllib.error
import urllib.request

API = "https://api.cryptomus.com"
APP = "https://api-app.cryptomus.com"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory venue survey probe"
SYMBOL = "BTC_USDT"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body, status, hdrs = r.read(), r.status, r.headers
    except urllib.error.HTTPError as e:
        body, status, hdrs = e.read(), e.code, e.headers
    except urllib.error.URLError as e:
        return None, None, str(e.reason).encode(), (time.perf_counter() - t0) * 1000
    return status, hdrs, body, (time.perf_counter() - t0) * 1000


def short(body, n=240):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section(title):
    print(f"\n== {title}")


def host_and_latency():
    section("1. host, exit and latency")
    status, _, body, _ = get("https://www.cloudflare.com/cdn-cgi/trace")
    trace = dict(line.split("=", 1) for line in body.decode().splitlines() if "=" in line)
    print(f"cloudflare trace status={status} loc={trace.get('loc')}")
    for host in ("api.cryptomus.com", "api-app.cryptomus.com", "cryptomus.com", "doc.cryptomus.com",
                 "api-ws.cryptomus.com", "exchange-ws.cryptomus.com"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except OSError as e:
            addrs = [f"unresolved: {e}"]
        print(f"dns {host} {addrs}")
    cold = []
    for _ in range(3):
        status, _, body, ms = get(f"{API}/v1/exchange/market/tickers")
        cold.append(ms)
        time.sleep(1)
    print(f"cold tickers (new TLS connection each) ms={[round(x) for x in cold]} status={status} bytes={len(body)}")
    conn = http.client.HTTPSConnection("api.cryptomus.com", timeout=20)
    warm = []
    for _ in range(6):
        t0 = time.perf_counter()
        conn.request("GET", "/v1/exchange/market/tickers", headers={"User-Agent": UA})
        r = conn.getresponse()
        r.read()
        warm.append((time.perf_counter() - t0) * 1000)
        time.sleep(1)
    conn.close()
    print(f"warm tickers (one kept-alive connection) ms={[round(x) for x in warm]} first one opens the connection")


def catalog():
    section("2. catalog")
    status, hdrs, body, ms = get(f"{API}/v2/user-api/exchange/markets")
    markets = json.loads(body)["result"]
    print(f"GET /v2/user-api/exchange/markets status={status} bytes={len(body)} ms={round(ms)} count={len(markets)}")
    print(f"top-level keys={sorted(json.loads(body))}")
    print(f"fields={sorted({k for m in markets for k in m})}")
    print(f"by quote={dict(collections.Counter(m['quoteCurrency'] for m in markets))}")
    symbols = [m["symbol"] for m in markets]
    print(f"duplicate symbols={[s for s, c in collections.Counter(symbols).items() if c > 1]}")
    print(f"symbols not BASE_QUOTE={[s for s in symbols if s.count('_') != 1]}")
    pairs = collections.Counter(m["baseCurrency"] for m in markets)
    print(f"bases listed against both USDT and USDC={sum(1 for c in pairs.values() if c > 1)}")
    btc = next(m for m in markets if m["symbol"] == SYMBOL)
    print(f"{SYMBOL} row={json.dumps(btc)}")
    time.sleep(1)
    status, _, body2, _ = get(f"{APP}/v1/exchange/market")
    app = json.loads(body2)["result"]
    print(f"GET api-app /v1/exchange/market status={status} count={len(app)} same symbol set={set(symbols) == {m['symbol'] for m in app}}")
    time.sleep(1)
    status, _, body3, _ = get(f"{API}/v1/exchange/market/tickers")
    tickers = json.loads(body3)
    rows = tickers.get("data") or tickers.get("result") or []
    print(f"GET /v1/exchange/market/tickers status={status} top-level keys={sorted(tickers)} rows={len(rows)}")
    print(f"ticker fields={sorted({k for t in rows for k in t})}")
    tset = {t["currency_pair"] for t in rows}
    print(f"tickers not in catalog={sorted(tset - set(symbols))} catalog not in tickers={sorted(set(symbols) - tset)}")
    zero = [t["currency_pair"] for t in rows if float(t.get("quote_volume") or 0) == 0]
    print(f"tickers with zero 24h quote volume={len(zero)}")
    top = sorted(rows, key=lambda t: -float(t.get("quote_volume") or 0))[:5]
    print(f"top 5 by quote volume={[(t['currency_pair'], round(float(t['quote_volume']))) for t in top]}")
    return symbols


def no_derivatives():
    section("3. derivatives check")
    for url in ("https://cryptomus.com/exchange/futures", "https://cryptomus.com/futures",
                f"{API}/v1/exchange/market/funding-rate", f"{API}/v1/exchange/market/mark-price"):
        status, _, body, _ = get(url)
        print(f"GET {url} status={status} body={short(body, 120)}")
        time.sleep(1)


def book(symbols):
    section("4. REST book")
    for level in range(0, 7):
        status, hdrs, body, ms = get(f"{API}/v1/exchange/market/order-book/{SYMBOL}?level={level}")
        if status != 200:
            print(f"level={level} status={status} body={short(body)}")
            time.sleep(1)
            continue
        d = json.loads(body)
        data = d.get("data") or d.get("result")
        bids, asks = data["bids"], data["asks"]
        bp = [float(x["price"]) for x in bids]
        ap = [float(x["price"]) for x in asks]
        steps = sorted({round(bp[i] - bp[i + 1], 8) for i in range(min(len(bp) - 1, 10))})
        print(f"level={level} status={status} bytes={len(body)} ms={round(ms)} keys={sorted(d)} data keys={sorted(data)} "
              f"bids={len(bids)} asks={len(asks)} best bid={bids[0]['price'] if bids else None} best ask={asks[0]['price'] if asks else None} "
              f"bids descending={bp == sorted(bp, reverse=True)} asks ascending={ap == sorted(ap)} first bid steps={steps[:5]} timestamp={data.get('timestamp')}")
        if level == 0:
            print(f"cache headers={ {k: hdrs.get(k) for k in ('Cache-Control', 'pragma', 'expires', 'Age', 'ETag')} }")
            print(f"level fields={sorted(bids[0])}")
        time.sleep(1)
    status, _, body, _ = get(f"{API}/v1/exchange/market/order-book/{SYMBOL}")
    print(f"no level param status={status} body={short(body)}")
    time.sleep(1)
    status, _, body, _ = get(f"{API}/v1/exchange/market/order-book/NOPE_USDT?level=0")
    print(f"unknown symbol status={status} body={short(body)}")
    time.sleep(1)
    quiet = symbols[-1]
    status, _, body, _ = get(f"{API}/v1/exchange/market/order-book/{quiet}?level=0")
    d = json.loads(body) if status == 200 else {}
    data = d.get("data") or {}
    print(f"last catalog symbol {quiet} status={status} bids={len(data.get('bids', []))} asks={len(data.get('asks', []))}")
    time.sleep(1)

    print("polling level 0 once a second for 12 polls")
    seen_ts, seen_top, offsets = [], [], []
    for _ in range(12):
        local = time.time()
        status, hdrs, body, ms = get(f"{API}/v1/exchange/market/order-book/{SYMBOL}?level=0")
        data = json.loads(body)["data"]
        seen_ts.append(data["timestamp"])
        seen_top.append((data["bids"][0]["price"], data["bids"][0]["quantity"], data["asks"][0]["price"], data["asks"][0]["quantity"]))
        offsets.append(round(float(data["timestamp"]) - local, 2))
        time.sleep(1)
    print(f"distinct timestamps={len(set(seen_ts))} of 12 distinct top of book={len(set(seen_top))} of 12")
    print(f"book timestamp minus local send time s={offsets}")


def errors_and_time():
    section("5. errors, limits and time")
    local = time.time()
    status, _, body, _ = get(f"{API}/v1/exchange/market/trades/{SYMBOL}")
    if status == 200:
        trades = json.loads(body)["data"]
        t0 = trades[0]
        print(f"GET /v1/exchange/market/trades/{SYMBOL} status=200 rows={len(trades)} newest age s={round(local - trades[0]['timestamp'])} "
              f"oldest age s={round(local - trades[-1]['timestamp'])} null prices={sum(1 for t in trades if t['price'] is None)}")
        print(f"first trade={json.dumps(t0)}")
        if t0["price"]:
            print(f"price times quote_volume={float(t0['price']) * float(t0['quote_volume']):.6f} against base_volume={t0['base_volume']}")
    else:
        print(f"GET /v1/exchange/market/trades/{SYMBOL} status={status} body={short(body, 200)}")
    time.sleep(1)
    for url in (f"{API}/v2/user-api/exchange/markets/price?symbol={SYMBOL}", f"{API}/v2/user-api/exchange/markets/price",
                f"{API}/v2/user-api/exchange/market/price?symbol={SYMBOL}", f"{API}/v1/does-not-exist",
                f"{API}/v2/user-api/exchange/account/tariffs"):
        status, hdrs, body, _ = get(url)
        rl = {k: v for k, v in (hdrs.items() if hdrs else []) if "limit" in k.lower() or k.lower() == "retry-after"}
        print(f"GET {url} status={status} limit headers={rl} body={short(body, 200)}")
        time.sleep(1)
    local = time.time()
    status, hdrs, _, ms = get(f"{API}/v1/exchange/market/tickers")
    server = email.utils.parsedate_to_datetime(hdrs["Date"]).timestamp()
    print(f"Date header minus local midpoint s={round(server - (local + ms / 2000), 2)} (Date has one second resolution)")


def main():
    host_and_latency()
    symbols = catalog()
    no_derivatives()
    book(symbols)
    errors_and_time()


if __name__ == "__main__":
    main()
