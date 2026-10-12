# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Gems Trade REST probe for docs/profiles/gems-trade/rest.md.

Public, unauthenticated and read-only, about forty requests spaced at least 0.3 s apart.
  1. Host: DNS, the CloudFront WAF's answer to several user agents, cold and warm request time.
  2. Catalog: /api/v2/peatio/public/markets, state and quote counts, the binance_engine and upstream flags, paging headers.
  3. No anchor: the futures base path the web app configures, and the tickers call.
  4. REST book: /public/markets/<id>/depth, limits, level order, the timestamp field, caching, and the order-book call.
  5. A comparison of the book top with Binance spot, read from data-api.binance.vision, for four markets flagged upstream.
  6. Rate limit headers and error shapes.
  7. Server time and clock offset.
Run from the repository root with: uv run scripts/probes/venues/gems-trade/rest-probe.py
"""

import http.client
import json
import socket
import statistics
import time
import urllib.error
import urllib.request
from datetime import datetime

HOST = "www.gems.trade"
SITE = "https://" + HOST
PEATIO = SITE + "/api/v2/peatio"
FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0"


def get(url, ua=FIREFOX):
    time.sleep(0.3)
    headers = {"Accept": "application/json"}
    if ua is not None:
        headers["User-Agent"] = ua
    req = urllib.request.Request(url, headers=headers)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000


def host():
    print("== 1. Host")
    name, aliases, addrs = socket.gethostbyname_ex(HOST)
    print(f"{HOST} resolves through {aliases + [name]} to {sorted(addrs)}")
    for u in ("https://gems.trade/", "https://blog.gems.trade/"):
        for label, ua in (("bare Mozilla/5.0", "Mozilla/5.0"), ("full Firefox", FIREFOX)):
            st, h, body, ms = get(u, ua)
            print(f"  {u} with {label}: status {st}, server {h.get('Server') or h.get('server')}, 'Request blocked' {b'Request blocked' in body}, maintenance plugin {b'plugins/maintenance' in body}")
    for label, ua in (("bare Mozilla/5.0", "Mozilla/5.0"), ("Python-urllib/3", "Python-urllib/3"),
                      ("curl/8.14.1", "curl/8.14.1"), ("full Firefox", FIREFOX)):
        st, h, body, ms = get(PEATIO + "/public/timestamp", ua)
        print(f"  UA {label}: status {st}, server {h.get('Server')}, x-cache {h.get('X-Cache')}, body {body[:80]!r}")
    st, h, body, ms = get(SITE + "/", "Mozilla/5.0")
    print(f"  page with bare Mozilla/5.0: status {st}, body contains 'Request blocked' {b'Request blocked' in body}")
    times = []
    conn = http.client.HTTPSConnection(HOST, timeout=30)
    for i in range(6):
        t0 = time.perf_counter()
        conn.request("GET", "/api/v2/peatio/public/timestamp", headers={"User-Agent": FIREFOX})
        r = conn.getresponse()
        r.read()
        times.append((time.perf_counter() - t0) * 1000)
        time.sleep(0.3)
    conn.close()
    print(f"  /public/timestamp on one connection: cold {times[0]:.0f} ms including TLS, warm median {statistics.median(times[1:]):.0f} ms over 5, via {r.getheader('Via')}, pop {r.getheader('X-Amz-Cf-Pop')}")


def catalog():
    print("== 2. Catalog, /public/markets")
    st, h, body, ms = get(PEATIO + "/public/markets")
    m = json.loads(body)
    print(f"status {st}, {len(body)} bytes, {ms:.0f} ms, rows {len(m)}, Total {h.get('Total')}, Per-Page {h.get('Per-Page')}, Page {h.get('Page')}")
    st2, h2, body2, _ = get(PEATIO + "/public/markets?limit=1000")
    print(f"  ?limit=1000: status {st2}, rows {len(json.loads(body2))}, Total {h2.get('Total')}")
    st3, h3, body3, _ = get(PEATIO + "/public/markets?limit=10&page=2")
    print(f"  ?limit=10&page=2: status {st3}, rows {len(json.loads(body3))}, Total {h3.get('Total')}, first {json.loads(body3)[0]['id'] if json.loads(body3) else None}")
    count = {}
    for x in m:
        k = (x["state"], x["quote_unit"], x.get("binance_engine"), x.get("upstream"), x.get("trading_enabled"), x.get("temporary_stop"))
        count[k] = count.get(k, 0) + 1
    print("  state, quote, binance_engine, upstream, trading_enabled, temporary_stop: count")
    for k, v in sorted(count.items(), key=str):
        print(f"    {k}: {v}")
    print(f"  not upstream: {[x['id'] for x in m if not x.get('upstream')]}")
    print(f"  ids are lowercase base+quote: {all(x['id'] == (x['base_unit'] + x['quote_unit']) for x in m)}")
    print(f"  types present: {sorted({str(x.get('type')) for x in m})}, keys of one row: {sorted(m[0])}")
    pp = {}
    for x in m:
        pp[x["price_precision"]] = pp.get(x["price_precision"], 0) + 1
    print(f"  price_precision spread: {dict(sorted(pp.items()))}")
    btc = next(x for x in m if x["id"] == "btcusdt")
    print(f"  btcusdt: {json.dumps({k: btc[k] for k in ('id', 'name', 'base_unit', 'quote_unit', 'price_precision', 'amount_precision', 'min_amount', 'min_total', 'min_allowed', 'max_allowed', 'min_price_percentage')})}")
    return m


def no_anchor(markets):
    print("== 3. No anchor")
    for path in ("/api/v2/future/public/markets", "/api/v2/future/public/timestamp", "/api/v2/peatio/public/markets/btcusdt/funding_rate"):
        st, h, body, ms = get(SITE + path)
        print(f"  {path}: status {st}, content-type {h.get('Content-Type')}, body {body[:120]!r}")
    st, h, body, ms = get(PEATIO + "/public/markets/tickers")
    t = json.loads(body)
    print(f"  /public/markets/tickers: status {st}, {len(body)} bytes, {ms:.0f} ms, markets {len(t)}")
    b = t["btcusdt"]
    print(f"  btcusdt at {b['at']}: {json.dumps({k: b['ticker'][k] for k in ('buy', 'sell', 'last', 'open', 'high', 'low', 'volume', 'total_volume', 'avg_price', 'usd_rate')})}")
    zero_bs = sum(1 for v in t.values() if float(v["ticker"]["buy"]) == 0 and float(v["ticker"]["sell"]) == 0)
    print(f"  tickers whose buy and sell are both 0: {zero_bs} of {len(t)}")
    keys = sorted({k for v in t.values() for k in v["ticker"]})
    print(f"  ticker keys: {keys}")


def book():
    print("== 4. REST book")
    for q in ("", "?limit=1", "?limit=30", "?limit=100", "?limit=1000", "?limit=5000"):
        st, h, body, ms = get(PEATIO + "/public/markets/btcusdt/depth" + q)
        try:
            d = json.loads(body)
            info = f"asks {len(d['asks'])}, bids {len(d['bids'])}, keys {sorted(d)}"
        except Exception:
            info = f"body {body[:120]!r}"
        print(f"  depth{q}: status {st}, {len(body)} bytes, {ms:.0f} ms, x-cache {h.get('X-Cache')}, cache-control {h.get('Cache-Control')}, {info}")
    st, h, body, ms = get(PEATIO + "/public/markets/btcusdt/depth?limit=50")
    d = json.loads(body)
    a = [float(p) for p, _ in d["asks"]]
    b = [float(p) for p, _ in d["bids"]]
    print(f"  asks ascending {a == sorted(a)}, bids descending {b == sorted(b, reverse=True)}, best bid {d['bids'][0]}, best ask {d['asks'][0]}, crossed {b[0] >= a[0]}")
    print(f"  timestamp {d['timestamp']} against local {time.time():.0f}")
    tops = []
    for i in range(10):
        st, h, body, ms = get(PEATIO + "/public/markets/btcusdt/depth?limit=5")
        d = json.loads(body)
        tops.append((d["timestamp"], d["bids"][0][0], d["asks"][0][0]))
        time.sleep(0.7)
    print(f"  ten polls about 1 s apart, (timestamp, best bid, best ask): {tops}")
    print(f"  distinct tops {len(set(t[1:] for t in tops))} of 10, distinct timestamps {len(set(t[0] for t in tops))}")
    st, h, body, ms = get(PEATIO + "/public/markets/btcusdt/order-book")
    print(f"  /public/markets/btcusdt/order-book: status {st}, body {body[:100]!r}")
    for mid in ("gemsusdt", "ethbtc"):
        st, h, body, ms = get(PEATIO + f"/public/markets/{mid}/depth?limit=50")
        d = json.loads(body)
        print(f"  {mid} depth?limit=50: status {st}, asks {len(d['asks'])}, bids {len(d['bids'])}, top bid {d['bids'][:1]}, top ask {d['asks'][:1]}")


def upstream():
    print("== 5. Book top against Binance spot, data-api.binance.vision")
    for mid, sym in (("btcusdt", "BTCUSDT"), ("ethusdt", "ETHUSDT"), ("solusdt", "SOLUSDT"), ("xrpusdt", "XRPUSDT")):
        st, h, body, ms = get(PEATIO + f"/public/markets/{mid}/depth?limit=5")
        g = json.loads(body)
        st2, h2, body2, ms2 = get(f"https://data-api.binance.vision/api/v3/depth?symbol={sym}&limit=5")
        if st2 != 200:
            print(f"  {mid}: Binance status {st2}, body {body2[:120]!r}")
            continue
        bn = json.loads(body2)
        gb, ga = float(g["bids"][0][0]), float(g["asks"][0][0])
        bb, ba = float(bn["bids"][0][0]), float(bn["asks"][0][0])
        mid_g, mid_b = (gb + ga) / 2, (bb + ba) / 2
        print(f"  {mid}: Gems bid {gb} ask {ga}, Binance bid {bb} ask {ba}, mid gap {(mid_g - mid_b) / mid_b * 1e4:+.2f} bp, Gems spread {(ga - gb) / mid_g * 1e4:.2f} bp, Binance spread {(ba - bb) / mid_b * 1e4:.2f} bp")
        print(f"    Gems top sizes bid {g['bids'][0][1]} ask {g['asks'][0][1]}, Binance top sizes bid {bn['bids'][0][1]} ask {bn['asks'][0][1]}")


def limits():
    print("== 6. Rate limit headers and errors")
    st, h, body, ms = get(PEATIO + "/public/markets/btcusdt/depth?limit=5")
    rl = {k: v for k, v in h.items() if "limit" in k.lower() or "retry" in k.lower()}
    print(f"  rate limit headers on a depth reply: {rl or 'none'}")
    print(f"  header names: {sorted(h)}")
    for path in ("/public/markets/foousdt/depth", "/public/markets/foousdt/trades", "/public/nonexistent", "/public/markets/btcusdt/depth?limit=abc"):
        st, h, body, ms = get(PEATIO + path)
        print(f"  {path}: status {st}, content-type {h.get('Content-Type')}, body {body[:160]!r}")
    st, h, body, ms = get(SITE + "/api/v2/barong/identity/ping")
    print(f"  /api/v2/barong/identity/ping: status {st}, body {body[:80]!r}")


def clock():
    print("== 7. Server time")
    offsets = []
    for i in range(5):
        t0 = time.time()
        st, h, body, ms = get(PEATIO + "/public/timestamp")
        t1 = time.time()
        server = datetime.fromisoformat(json.loads(body)).timestamp()
        offsets.append(server - (t0 + t1) / 2)
    print(f"  /public/timestamp body example {body!r}, whole seconds only")
    print(f"  server minus local midpoint, five reads: {[round(o, 2) for o in offsets]}, median {statistics.median(offsets):+.2f} s")
    print(f"  Date header {h.get('Date')}")


if __name__ == "__main__":
    host()
    markets = catalog()
    no_anchor(markets)
    book()
    upstream()
    limits()
    clock()
