# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Unocoin futures REST probe for docs/profiles/unocoin/rest.md.

Public, unauthenticated and read-only.
It sends about 50 requests to api.unocoin.com over about two minutes, never more than one at a time, plus a few to fapi.binance.com for comparison.
Unocoin publishes no REST rate limit, so the probe keeps at least one second between anchor polls.
Run from the repository root with: uv run scripts/probes/venues/unocoin/rest-probe.py
"""

import collections
import email.utils
import json
import socket
import statistics
import time
import urllib.error
import urllib.request

API = "https://api.unocoin.com/api"
BINANCE = "https://fapi.binance.com"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}


def get(url):
    """Return status, headers, body text and elapsed ms, without raising on HTTP errors."""
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            body = r.read().decode("utf-8", "replace")
            status, headers = r.status, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        status, headers = e.code, {k.lower(): v for k, v in e.headers.items()}
    return status, headers, body, (time.perf_counter() - t0) * 1000


def section(title):
    print(f"\n== {title}")


def host_and_latency():
    section("1. host and latency")
    for host in ["api.unocoin.com", "pi42-stream.unocoin.com", "unocoin.com"]:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
        print(host, "resolves to", sorted({i[4][0] for i in infos}))
    times, offsets = [], []
    for i in range(6):
        t_send = time.time()
        st, h, body, ms = get(API + "/v1/futures/market/ticker24Hr/BTCINR")
        t_recv = time.time()
        times.append(ms)
        server = email.utils.parsedate_to_datetime(h["date"]).timestamp()
        offsets.append(server - (t_send + t_recv) / 2)
        if i == 0:
            print("headers of a 200:", {k: v for k, v in h.items() if k in ("server", "cf-ray", "x-powered-by", "tz", "cache-control", "etag", "access-control-allow-origin")})
            print("rate limit headers:", {k: v for k, v in h.items() if "limit" in k or "retry" in k} or "none")
        time.sleep(1)
    print(f"ticker24Hr ms: cold {times[0]:.0f}, warm median {statistics.median(times[1:]):.0f}, warm max {max(times[1:]):.0f}")
    print(f"Date header offset s (1 s resolution): median {statistics.median(offsets):+.2f}")
    st, h, body, ms = get(API + "/v1/futures/market/ticker24Hr/BTCINR")
    j = json.loads(body)["data"]
    print(f"ticker event time E minus local clock ms: {j['E'] - time.time() * 1000:+.0f} (includes relay delay)")


def catalog():
    section("2. catalog GET /v1/futures/app-pairs")
    st, h, body, ms = get(API + "/v1/futures/app-pairs")
    d = json.loads(body)
    c = d["contracts"]
    print(f"status {st}, {len(body)} bytes, {ms:.0f} ms, keys {list(d)}, markets {d['markets']}")
    print("contracts:", len(c))
    for k in ["contract_type", "status", "type", "quote_asset", "market", "maker_fee", "taker_fee", "liquidation_fee", "funding_fee_interval", "unocoin_max_leverage"]:
        print(f"  {k}:", dict(collections.Counter(str(x.get(k)) for x in c)))
    print("  margin_assets_supported:", dict(collections.Counter(str(x.get("margin_assets_supported")) for x in c)))
    for x in c:
        filt = {f["filterType"]: f for f in x["filters"]}
        print(f"  {x['symbol']:8} base {x['base_asset']:5} max_leverage {x['max_leverage']:>3} unocoin {x.get('unocoin_max_leverage')} depth_grouping {x['depth_grouping']} qty_precision {x['quantity_precision']} price_precision {x['price_precision']} minQty {filt['LIMIT_QTY_SIZE']['minQty']} minNotional {filt['MIN_NOTIONAL']['notional']}")
    print("pairs listed twice:", [s for s, n in collections.Counter(x["base_asset"] for x in c).items() if n > 1] or "none")
    print("BTCINR full row:", json.dumps(c[0])[:1600])
    return [x["symbol"] for x in c]


def anchor(symbols):
    section("3. anchor GET /v1/futures/market/marketInfo")
    sizes, times = [], []
    for _ in range(3):
        st, h, body, ms = get(API + "/v1/futures/market/marketInfo")
        sizes.append(len(body))
        times.append(ms)
        time.sleep(1)
    m = json.loads(body)
    print(f"status {st}, bytes {sizes}, ms {[round(t) for t in times]}")
    print("rows:", len(m), "field sets:", dict(collections.Counter(tuple(sorted(v)) for v in m.values())))
    print("catalog symbols present:", sum(s in m for s in symbols), "of", len(symbols))
    print("rows outside the Unocoin catalog:", len(set(m) - set(symbols)))
    print("BTCINR row:", m.get("BTCINR"))
    rates = [float(m[s]["upcomingFundingRate"]) for s in symbols]
    print("upcomingFundingRate over the catalog: min", min(rates), "max", max(rates))
    for path in ["/v1/futures/market/fundingRate", "/v1/futures/market/premiumIndex", "/v1/futures/market/markPrice/BTCINR", "/v1/futures/market/fundingRateHistory/BTCINR", "/v1/futures/market/indexPrice/BTCINR"]:
        st, h, body, ms = get(API + path)
        print(f"guess {path}: {st} {body[:120]}")
        time.sleep(1)
    return m


def compare_binance(m):
    section("4. anchor semantics against Binance USD-M")
    st, h, body, ms = get(BINANCE + "/fapi/v1/premiumIndex?symbol=BTCUSDT")
    print(f"Binance premiumIndex status {st}")
    if st == 200:
        b = json.loads(body)
        u = m["BTCINR"]
        print(f"Binance lastFundingRate {b['lastFundingRate']} nextFundingTime {b['nextFundingTime']} mark {b['markPrice']} index {b['indexPrice']}")
        print(f"Unocoin BTCINR upcomingFundingRate {u['upcomingFundingRate']} marketPrice {u['marketPrice']}")
        print(f"implied INR per USDT from the mark: {float(u['marketPrice']) / float(b['markPrice']):.4f}")
        print(f"Unocoin rate over Binance rate: {float(u['upcomingFundingRate']) / float(b['lastFundingRate']):.4f}")
        st, h, body, ms = get(BINANCE + "/fapi/v1/fundingRate?symbol=BTCUSDT&limit=3")
        print(f"Binance last three settled BTCUSDT rates: {[(r['fundingTime'], r['fundingRate']) for r in json.loads(body)]}")
    print("BTCINR over about 60 s of polls, one every 2 s plus the reply time:")
    seen = collections.defaultdict(list)
    t0 = time.time()
    n = 0
    while time.time() - t0 < 60:
        st, h, body, ms = get(API + "/v1/futures/market/marketInfo")
        n += 1
        if st != 200:
            print("  poll status", st, body[:200])
            break
        r = json.loads(body)["BTCINR"]
        for k in ("marketPrice", "upcomingFundingRate", "lastPrice"):
            seen[k].append(r[k])
        time.sleep(2)
    for k, v in seen.items():
        changes = sum(1 for a, b in zip(v, v[1:]) if a != b)
        print(f"  {k}: {n} polls, {changes} changes, distinct {len(set(v))}, first {v[0]}, last {v[-1]}")


def book():
    section("5. REST book GET /v1/futures/market/depth/<symbol>")
    for path in ["/v1/futures/market/depth/BTCINR", "/v1/futures/market/depth/BTCINR?limit=5", "/v1/futures/market/depth/btcinr"]:
        st, h, body, ms = get(API + path)
        d = json.loads(body)["data"]
        bids = [float(p) for p, q in d["b"]]
        asks = [float(p) for p, q in d["a"]]
        print(f"{path}: {st} {len(body)} bytes {ms:.0f} ms, e {d['e']} s {d['s']} ps {d['ps']} U {d['U']} u {d['u']} pu {d['pu']}")
        print(f"  bids {len(bids)} ascending {bids == sorted(bids)}, asks {len(asks)} ascending {asks == sorted(asks)}, best bid {max(bids)} best ask {min(asks)}")
        time.sleep(1)
    a = json.loads(get(API + "/v1/futures/market/depth/BTCINR")[2])["data"]
    time.sleep(0.3)
    b = json.loads(get(API + "/v1/futures/market/depth/BTCINR")[2])["data"]
    print(f"two calls 0.3 s apart: u {a['u']} then {b['u']}, same {a['u'] == b['u']}")
    for path in ["/v1/futures/market/depth/SANDINR", "/v1/futures/market/depth/FOOINR", "/v1/futures/market/ticker24Hr/SANDINR"]:
        st, h, body, ms = get(API + path)
        print(f"{path}: {st} {body[:200]}")
        time.sleep(1)
    st, h, body, ms = get(API + "/v1/futures/market/aggTrade/BTCINR")
    print(f"aggTrade: {st}, {len(json.loads(body)['data'])} trades, first {json.loads(body)['data'][0]}")


def spot():
    section("6. spot surface, named only")
    st, h, body, ms = get(API + "/exchange/app-pairs")
    d = json.loads(body)
    print(f"/exchange/app-pairs: {st}, {len(body)} bytes, markets {list(d)}, pairs {sum(len(v) for v in d.values())}")
    print("  trading_enabled:", dict(collections.Counter(str(x.get("trading_enabled")) for v in d.values() for x in v)))
    st, h, body, ms = get(API + "/v1/asset/marketdata")
    rows = json.loads(body)
    print(f"/v1/asset/marketdata: {st}, {len(rows)} rows, first {rows[0]}")


def main():
    print("started", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    host_and_latency()
    symbols = catalog()
    m = anchor(symbols)
    compare_binance(m)
    book()
    spot()
    print("\nfinished", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))


if __name__ == "__main__":
    main()
