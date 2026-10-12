# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Binance TR REST probe for docs/profiles/binance-tr/rest.md.

Public, unauthenticated and read-only, about 75 requests over about 40 seconds.
The heaviest is the depth call at limit 5000, weight 250, and one run spends about 450 of Binance's 6,000 per minute IP weight.
  1. DNS for every host the API docs and the web app's system-config name.
  2. Cold and warm request time for the server time, the catalog and the REST book.
  3. The catalog at /open/v1/common/symbols: types, quotes, permissions, flags and filters.
  4. Binance's own exchangeInfo for TRY pairs, to set the TR catalog against Binance spot.
  5. The same book read from the four hosts that serve it, to show whether they are one book.
  6. Depth limits, level order, the weight header and the server time offset.
  7. Error shapes: unknown symbol, wrong spelling, bad limit.
  8. Derivative and reference price paths: premium index, funding and mark on the TR hosts.
Run from the repository root with: uv run scripts/probes/venues/binance-tr/rest-probe.py
"""

import collections
import email.utils
import json
import socket
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json"}
WWW = "https://www.binance.tr"
ME = "https://api.binance.me"
EDGE = "https://edge.binance.tr"
GLOBAL = "https://api.binance.com"


def get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:  # DNS failure, timeout, TLS error
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000


def head(body, n=200):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def hdr(h, name):
    for k, v in h.items():
        if k.lower() == name.lower():
            return v
    return None


def section_dns():
    print("== 1. DNS")
    for h in ("www.binance.tr", "binance.tr", "www.trbinance.com", "api.binance.me", "edge.binance.tr", "stream-cloud.binance.tr",
              "ws-api.binance.tr", "cloudme-tr.2meta.app", "stream-tr.2meta.app", "api.binance.com", "stream.binance.com"):
        try:
            canon, _, addrs = socket.gethostbyname_ex(h)
            print(f"{h}: {sorted(addrs)} canonical {canon}")
        except OSError as e:
            print(f"{h}: {e}")


def section_latency():
    print("== 2. Latency, three requests each, the first one cold")
    for url in (WWW + "/open/v1/common/time", WWW + "/open/v1/common/symbols", ME + "/api/v3/depth?symbol=BTCTRY&limit=20",
                WWW + "/open/v1/market/depth?symbol=BTC_TRY&limit=20", EDGE + "/api/v3/depth?symbol=BTCTRY&limit=20"):
        runs = []
        for _ in range(3):
            s, h, body, ms = get(url)
            runs.append(f"{s} {ms:.0f} ms {len(body)} B")
        print(f"{url}: {runs} server {hdr(h, 'server')} pop {hdr(h, 'x-amz-cf-pop')} cache {hdr(h, 'x-cache')}")


def section_catalog():
    print("== 3. Catalog /open/v1/common/symbols")
    s, h, body, ms = get(WWW + "/open/v1/common/symbols")
    d = json.loads(body)
    rows = d["data"]["list"]
    print(f"status {s} code {d['code']} msg {d['msg']} rows {len(rows)} bytes {len(body)}")
    print("type", dict(collections.Counter(r["type"] for r in rows)))
    print("quote", dict(collections.Counter(r["quoteAsset"] for r in rows)))
    print("permissions", dict(collections.Counter(",".join(r.get("permissions", [])) for r in rows)))
    print("spotTradingEnable, marginTradingEnable", dict(collections.Counter((r.get("spotTradingEnable"), r.get("marginTradingEnable")) for r in rows)))
    print("keys", sorted(rows[0].keys()))
    print("status-like keys present", sorted({k for r in rows for k in r if "status" in k.lower()}))
    btc = next(r for r in rows if r["symbol"] == "BTC_TRY")
    print("BTC_TRY filters", json.dumps({f["filterType"]: {k: v for k, v in f.items() if k not in ("filterType", "applyToMarket")} for f in btc["filters"]}))
    print("first 10", [r["symbol"] for r in rows[:10]])
    return {r["symbol"].replace("_", "") for r in rows}


def section_global(tr):
    print("== 4. Binance exchangeInfo, TRY pairs, set against the TR catalog")
    s, h, body, ms = get(GLOBAL + "/api/v3/exchangeInfo?permissions=SPOT")
    if s != 200:
        print(f"api.binance.com exchangeInfo {s} {head(body)}")
        return
    sy = json.loads(body)["symbols"]
    trys = [x for x in sy if x["quoteAsset"] == "TRY"]
    trading = {x["symbol"] for x in trys if x["status"] == "TRADING"}
    print(f"exchangeInfo {s} {len(body)} B {ms:.0f} ms weight {hdr(h, 'x-mbx-used-weight-1m')}, TRY rows {len(trys)}, status {dict(collections.Counter(x['status'] for x in trys))}")
    print(f"TR catalog {len(tr)}, in Binance TRADING {len(tr & trading)}, TR only {sorted(tr - trading)[:20]}, Binance TRADING not on TR {len(trading - tr)} e.g. {sorted(trading - tr)[:15]}")


def book(url):
    s, h, body, ms = get(url)
    try:
        d = json.loads(body)
    except ValueError:
        return s, None, ms, h
    d = d.get("data", d) if isinstance(d, dict) else d
    return s, d, ms, h


def section_shared():
    print("== 5. One book or four: BTCTRY and ETHTRY read from each host in quick succession, three rounds")
    for sym in ("BTCTRY", "ETHTRY"):
        und = sym[:-3] + "_TRY"
        for rnd in range(3):
            out = []
            for name, url in (("api.binance.me", f"{ME}/api/v3/depth?symbol={sym}&limit=5"),
                              ("www /open/v1", f"{WWW}/open/v1/market/depth?symbol={und}&limit=5"),
                              ("edge.binance.tr", f"{EDGE}/api/v3/depth?symbol={sym}&limit=5"),
                              ("api.binance.com", f"{GLOBAL}/api/v3/depth?symbol={sym}&limit=5")):
                s, d, ms, _ = book(url)
                if d and "lastUpdateId" in d:
                    out.append(f"{name} {s} id {d['lastUpdateId']} bid {d['bids'][0]} ask {d['asks'][0]} {ms:.0f} ms")
                else:
                    out.append(f"{name} {s} {d}")
            print(f"{sym} round {rnd + 1}: " + " | ".join(out))
            time.sleep(1)


def section_depth():
    print("== 6. Depth limits, level order, weight, time offset")
    for lim in (5, 7, 20, 100, 500, 1000, 5000):
        s, d, ms, h = book(f"{ME}/api/v3/depth?symbol=BTCTRY&limit={lim}")
        if d and "bids" in d:
            bids = [float(p) for p, _ in d["bids"]]
            asks = [float(p) for p, _ in d["asks"]]
            print(f"limit {lim}: {s} bids {len(bids)} asks {len(asks)} bids descending {bids == sorted(bids, reverse=True)} asks ascending {asks == sorted(asks)} {ms:.0f} ms weight-1m {hdr(h, 'x-mbx-used-weight-1m')}")
        else:
            print(f"limit {lim}: {s} {d}")
    for lim in (5, 50, 100, 500):
        s, d, ms, h = book(f"{WWW}/open/v1/market/depth?symbol=BTC_TRY&limit={lim}")
        n = (len(d["bids"]), len(d["asks"])) if d and "bids" in d else d
        print(f"www /open/v1/market/depth limit {lim}: {s} levels {n} {ms:.0f} ms cache-control {hdr(h, 'cache-control')} age {hdr(h, 'age')}")
    s, d, ms, h = book(f"{ME}/api/v3/depth?symbol=BTCTRY&limit=1")
    print(f"limit 1: {s} {d if not d or 'bids' not in d else (len(d['bids']), len(d['asks']))}")
    for name, url in (("www", WWW + "/open/v1/common/time"), ("api.binance.me", ME + "/api/v3/time")):
        t0 = time.time() * 1000
        s, h, body, ms = get(url)
        t1 = time.time() * 1000
        j = json.loads(body)
        st = j.get("timestamp") or j.get("serverTime")
        print(f"{name} time {s} server {st} local mid {(t0 + t1) / 2:.0f} offset {st - (t0 + t1) / 2:+.0f} ms round trip {ms:.0f} ms Date {hdr(h, 'date')}")
    s, h, body, ms = get(ME + "/api/v3/depth?symbol=BTCTRY&limit=5")
    print("api.binance.me headers", {k: v for k, v in h.items() if k.lower().startswith("x-mbx") or k.lower() in ("retry-after", "cache-control", "server")})
    s, h, body, ms = get(WWW + "/open/v1/market/depth?symbol=BTC_TRY&limit=5")
    print("www headers", {k: v for k, v in h.items() if k.lower().startswith("x-mbx") or k.lower() in ("retry-after", "cache-control", "server", "x-cache")})


def section_errors():
    print("== 7. Error shapes")
    for url in (ME + "/api/v3/depth?symbol=NOPETRY&limit=5", ME + "/api/v3/depth?symbol=BTC_TRY&limit=5",
                WWW + "/open/v1/market/depth?symbol=NOPE_TRY&limit=5",
                WWW + "/open/v1/market/depth?symbol=BTCTRY&limit=5", WWW + "/open/v1/nope",
                ME + "/api/v3/depth?symbol=BTCUSDT&limit=5", ME + "/api/v3/ticker/bookTicker?symbol=BTCTRY",
                ME + "/api/v3/ticker/price?symbol=BTCTRY", ME + "/api/v3/avgPrice?symbol=BTCTRY"):
        s, h, body, ms = get(url)
        print(f"{url}: {s} {head(body, 160)!r}")


def section_derivatives():
    print("== 8. Derivative and reference price paths on the TR hosts")
    for url in (ME + "/fapi/v1/premiumIndex?symbol=BTCUSDT", ME + "/fapi/v1/exchangeInfo", WWW + "/fapi/v1/premiumIndex",
                WWW + "/open/v1/futures/symbols", WWW + "/open/v1/market/mark-price", WWW + "/open/v1/market/funding-rate",
                EDGE + "/fapi/v1/premiumIndex?symbol=BTCUSDT", EDGE + "/api/v3/ticker/price?symbol=BTCTRY"):
        s, h, body, ms = get(url)
        print(f"{url}: {s} {head(body, 140)!r}")


def main():
    print(f"run at {email.utils.formatdate(usegmt=True)}")
    section_dns()
    section_latency()
    tr = section_catalog()
    section_global(tr)
    section_shared()
    section_depth()
    section_errors()
    section_derivatives()


if __name__ == "__main__":
    main()
