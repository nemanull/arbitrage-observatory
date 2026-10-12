# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Feather Exchange (ftrex.io) REST probe for docs/profiles/feather/rest.md and websocket.md.

Public, unauthenticated and read-only.
It resolves the host, times cold and warm requests, shows the edge's User-Agent refusal, reads the two catalog calls,
the three REST book calls, the derivative paths the bundle does not name, the error shapes, and the Date header.
It compares the BTC_USDT and ETH_USDT books with Binance's public spot book fetched at the same moment.
About 60 requests to ftrex.io over about 40 s, and 4 to Binance's public market data host.
Run from the repository root with: uv run scripts/probes/venues/feather/rest-probe.py
"""

import email.utils
import http.client
import json
import socket
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36"
HOST = "ftrex.io"
API = f"https://{HOST}/api"


def get(url, method="GET", ua=UA, data=None):
    req = urllib.request.Request(url, method=method, data=data, headers={"User-Agent": ua})
    t = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode(), dict(r.headers), 1000 * (time.monotonic() - t)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace"), dict(e.headers), 1000 * (time.monotonic() - t)


def short(body, n=300):
    body = " ".join(body.split())
    return body if len(body) <= n else body[:n] + f" ... ({len(body)} chars)"


def section(title):
    print(f"\n== {title}")


def host_and_latency():
    section("host and latency")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    print(f"{HOST} resolves to {addrs}")
    cold = []
    for _ in range(3):
        status, _, _, ms = get(f"{API}/market/symbol-thumb", method="POST", data=b"")
        cold.append(ms)
        time.sleep(1)
    print(f"cold POST /market/symbol-thumb, new TLS each: {[round(x) for x in cold]} ms, status {status}")
    conn = http.client.HTTPSConnection(HOST, timeout=20)
    warm = []
    for _ in range(6):
        t = time.monotonic()
        conn.request("POST", "/api/market/symbol-thumb", body=b"", headers={"User-Agent": UA, "Content-Length": "0"})
        r = conn.getresponse()
        r.read()
        warm.append(1000 * (time.monotonic() - t))
        time.sleep(0.5)
    conn.close()
    print(f"warm on one connection: {[round(x) for x in warm]} ms, median of last 5 {statistics.median(warm[1:]):.0f} ms")


def user_agent_refusal():
    section("edge refusal by User-Agent")
    for ua in ["Mozilla/5.0", "Python-urllib/3.12", UA]:
        status, body, headers, _ = get(f"https://{HOST}/en", ua=ua)
        print(f"GET /en with User-Agent {ua[:40]!r}: {status}, server {headers.get('Server')}, body {short(body, 120)}")
        time.sleep(0.5)
    status, body, _, _ = get(f"{API}/market/symbol-thumb", method="POST", data=b"", ua="Python-urllib/3.12")
    print(f"POST /api/market/symbol-thumb with Python-urllib: {status}, body {short(body, 120)}")


def catalog():
    section("catalog: GET /api/market/symbol")
    status, body, headers, ms = get(f"{API}/market/symbol")
    rows = json.loads(body)
    print(f"status {status}, {len(body)} bytes, {ms:.0f} ms, {len(rows)} rows, fields {sorted(rows[0].keys())}")
    for r in rows:
        print(f"  {r['symbol']}: symbolId {r['symbolId']}, enable {r['enable']}, visible {r['visible']}, exchangeable {r['exchangeable']}, "
              f"matchingMode {r['matchingMode']}, externalMatching {r.get('externalMatching')}, fee {r['fee']}, feeInBaseSymbol {r['feeInBaseSymbol']}, "
              f"minAmount {r['minAmount']}, minTurnover {r['minTurnover']}, coinScale {r['coinScale']}, baseCoinScale {r['baseCoinScale']}")
    bases = sorted({r["baseSymbol"] for r in rows})
    print(f"quote assets {bases}, EXTERNAL {sum(r['matchingMode'] == 'EXTERNAL' for r in rows)}, LOCAL {sum(r['matchingMode'] == 'LOCAL' for r in rows)}")
    time.sleep(0.5)
    section("catalog: POST /api/market/symbol-thumb")
    status, body, _, ms = get(f"{API}/market/symbol-thumb", method="POST", data=b"")
    thumbs = json.loads(body)
    print(f"status {status}, {len(body)} bytes, {ms:.0f} ms, {len(thumbs)} rows, fields {sorted(thumbs[0].keys())}")
    for t in thumbs:
        print(f"  {t['symbol']}: close {t['close']}, guidancePrice {t['guidancePrice']}, usdRate {t['usdRate']}, volume {t['volume']}, turnover {t['turnover']}")
    return [r["symbol"] for r in rows]


def derivative_paths():
    section("derivative paths, none named in the web bundle")
    for p in ["swap/symbol-thumb", "contract/symbol-thumb", "swap/market/symbol", "futures/market/symbol", "market/funding-rate?symbol=BTC_USDT", "market/mark-price?symbol=BTC_USDT"]:
        status, body, _, _ = get(f"{API}/{p}")
        print(f"GET /api/{p}: {status} {short(body, 120)}")
        time.sleep(0.5)


def rest_books():
    section("REST book calls for BTC_USDT")
    for p in ["exchange-plate-mini", "exchange-plate", "exchange-plate-full"]:
        status, body, headers, ms = get(f"{API}/market/{p}?symbol=BTC_USDT")
        d = json.loads(body)
        bids, asks = d["bidItems"], d["askItems"]
        bid_desc = [b["price"] for b in bids] == sorted([b["price"] for b in bids], reverse=True)
        ask_asc = [a["price"] for a in asks] == sorted([a["price"] for a in asks])
        print(f"/market/{p}: {status}, {len(body)} bytes, {ms:.0f} ms, bids {len(bids)} asks {len(asks)}, bids descending {bid_desc}, asks ascending {ask_asc}, "
              f"keys {sorted(d.keys())}, level keys {sorted(bids[0].keys()) if bids else []}, cache-control {headers.get('Cache-Control')}")
        time.sleep(0.5)
    for q in ["depth=100", "limit=100", "size=100"]:
        status, body, _, _ = get(f"{API}/market/exchange-plate-full?symbol=BTC_USDT&{q}")
        d = json.loads(body)
        print(f"/market/exchange-plate-full with {q}: bids {len(d['bidItems'])} asks {len(d['askItems'])}")
        time.sleep(0.5)
    status, body, _, _ = get(f"{API}/market/exchange-plate-mini?symbol=FOO_USDT")
    print(f"unknown symbol FOO_USDT: {status} {short(body)}")
    status, body, _, _ = get(f"{API}/market/exchange-plate-mini?symbol=BTC/USDT")
    print(f"slash spelling BTC/USDT: {status} {short(body)}")
    status, body, _, _ = get(f"{API}/market/exchange-plate-mini")
    print(f"no symbol parameter: {status} {short(body)}")
    section("REST book refresh, 10 polls of exchange-plate-mini at 1 s")
    prev, changes, tops = None, 0, []
    for _ in range(10):
        _, body, _, _ = get(f"{API}/market/exchange-plate-mini?symbol=BTC_USDT")
        d = json.loads(body)
        key = json.dumps([d["bidItems"], d["askItems"]])
        changes += prev is not None and key != prev
        prev = key
        tops.append((d["bidItems"][0]["price"], d["askItems"][0]["price"]))
        time.sleep(1)
    print(f"book changed on {changes} of 9 polls, tops {tops}")


def binance_compare(symbol, bsymbol):
    def ours():
        return json.loads(get(f"{API}/market/exchange-plate-mini?symbol={symbol}")[1])

    def theirs():
        return json.loads(get(f"https://data-api.binance.vision/api/v3/depth?symbol={bsymbol}&limit=20")[1])

    with ThreadPoolExecutor(2) as ex:
        a, b = ex.submit(ours), ex.submit(theirs)
        f, bn = a.result(), b.result()
    fb = [(x["price"], x["amount"]) for x in f["bidItems"]]
    fa = [(x["price"], x["amount"]) for x in f["askItems"]]
    bb = [(float(p), float(q)) for p, q in bn["bids"]]
    ba = [(float(p), float(q)) for p, q in bn["asks"]]
    bprices = {p for p, _ in bb} | {p for p, _ in ba}
    shared = sum(p in bprices for p, _ in fb + fa)
    exact = len(set(fb + fa) & set(bb + ba))
    print(f"{symbol} against Binance {bsymbol}: Feather top {fb[0]} / {fa[0]}, Binance top {bb[0]} / {ba[0]}")
    print(f"  Feather levels whose price is on Binance's top 20: {shared} of {len(fb) + len(fa)}, levels equal in price and size: {exact}")
    print(f"  first 5 Feather bids {fb[:5]}")
    print(f"  first 5 Binance bids {bb[:5]}")


def mirror_check():
    section("book against Binance spot, fetched at the same moment")
    binance_compare("BTC_USDT", "BTCUSDT")
    time.sleep(1)
    binance_compare("ETH_USDT", "ETHUSDT")


def errors_and_time():
    section("error shapes and server time")
    for p in ["nonexistent", "market/symbol-info?symbol=BTC_USDT"]:
        status, body, headers, _ = get(f"{API}/{p}")
        print(f"GET /api/{p}: {status} {short(body)}")
        time.sleep(0.5)
    offsets = []
    for _ in range(3):
        t0 = time.time()
        _, _, headers, ms = get(f"{API}/market/symbol")
        server = email.utils.parsedate_to_datetime(headers["Date"]).timestamp()
        offsets.append(server - (t0 + ms / 2000))
        time.sleep(0.5)
    print(f"Date header offsets (server minus local midpoint, 1 s resolution): {[round(x, 2) for x in offsets]} s")
    print(f"response headers on /market/symbol: {sorted(headers.keys())}")
    rl = {k: v for k, v in headers.items() if "limit" in k.lower() or "retry" in k.lower()}
    print(f"rate limit headers: {rl or 'none'}")
    now_ms = int(time.time() * 1000)
    status, body, _, _ = get(f"{API}/market/history?symbol=BTC_USDT&resolution=1&from={now_ms - 300000}&to={now_ms}")
    rows = json.loads(body)
    print(f"/market/history 1 minute bars over the last 5 minutes: {status}, {len(rows)} rows, last {rows[-1] if rows else None}")


def burst():
    section("burst: 20 GETs of /market/symbol at about 4 per second")
    codes = {}
    for _ in range(20):
        status, _, _, _ = get(f"{API}/market/symbol")
        codes[status] = codes.get(status, 0) + 1
        time.sleep(0.25)
    print(f"status counts {codes}")


def main():
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    host_and_latency()
    user_agent_refusal()
    catalog()
    derivative_paths()
    rest_books()
    mirror_check()
    errors_and_time()
    burst()


main()
