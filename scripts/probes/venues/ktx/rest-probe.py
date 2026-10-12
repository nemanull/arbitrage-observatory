# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""KTX public REST probe for docs/profiles/ktx/rest.md and fees.md.

Read-only and unauthenticated.
It sends about 160 requests, never more than 2 per second, far inside the published 10,000 requests per 10 seconds per IP.
Run from the repository root with: uv run scripts/probes/venues/ktx/rest-probe.py
"""

import collections
import http.client
import json
import socket
import ssl
import statistics
import time

HOST = "api.ktx.com"
BASE = "/api"
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
POLL_SECONDS = 60

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(path: str, host: str = HOST, fresh: bool = False):
    """GET over one kept-alive connection per host. Returns status, headers, body text, seconds."""
    if fresh and host in _conns:
        _conns.pop(host).close()
    if host not in _conns:
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    t0 = time.perf_counter()
    try:
        conn.request("GET", path, headers=UA)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        _conns.pop(host, None)
        conn.close()
        return get(path, host, fresh=True)
    dt = time.perf_counter() - t0
    time.sleep(0.5)
    return resp.status, {k.lower(): v for k, v in resp.getheaders()}, body, dt


def get_json(path: str, host: str = HOST, fresh: bool = False):
    status, headers, body, dt = get(path, host, fresh)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    return status, headers, body, dt, data


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def ms(x: float) -> str:
    return f"{1000 * x:.0f} ms"


def host_and_latency() -> None:
    section("1. host and latency")
    for host in (HOST, "m-stream.ktx.com", "api.ktx.news", "api.ktx.exchange", "www.ktx.com"):
        try:
            addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as exc:
            addrs = [f"resolve failed: {exc}"]
        print(f"{host}: {addrs}")
    cold = []
    for _ in range(3):
        _, _, _, dt = get(BASE + "/v1/ping", fresh=True)
        cold.append(dt)
    warm = []
    for _ in range(5):
        _, h, body, dt = get(BASE + "/v1/ping")
        warm.append(dt)
    print(f"cold GET /api/v1/ping on a new TLS connection: {[ms(x) for x in cold]}")
    print(f"warm GET /api/v1/ping: {[ms(x) for x in warm]}, median {ms(statistics.median(warm))}")
    print(f"ping body {body}, cf-ray {h.get('cf-ray')}, server {h.get('server')}, ktx-usage {h.get('ktx-usage')}")
    st, h, body, dt = get(BASE + "/v1/pu/domains")
    print(f"GET /api/v1/pu/domains: {st} {body}")
    for host in ("api.ktx.news", "api.ktx.exchange"):
        try:
            st, h, body, dt = get(BASE + "/v1/time", host=host)
            print(f"backup host {host} GET /api/v1/time: {st} {body[:120]} in {ms(dt)}")
        except OSError as exc:
            print(f"backup host {host}: {exc}")


def catalog():
    section("2. catalog")
    st, h, body, dt, data = get_json(BASE + "/v1/products?market=lpc")
    lpc = data["result"]
    print(f"GET /api/v1/products?market=lpc: {st}, {len(body)} bytes in {ms(dt)}, content-type {h.get('content-type')}, ktx-usage {h.get('ktx-usage')}, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, cache-control {h.get('cache-control')}")
    newest = max(int(p["time"]) for p in data["result"])
    print(f"  newest row time field is {time.time() - newest / 1000:.1f} s old")
    print(f"rows {len(lpc)}, keys {sorted(lpc[0])}")
    print("BTC row:", json.dumps(next(p for p in lpc if p["symbol"] == "BTC_USDT_SWAP"), sort_keys=True))
    active = [p for p in lpc if p["active"] == 1]
    print(f"active 1: {len(active)}, active 0: {len(lpc) - len(active)}")
    print("inactive symbols:", [p["symbol"] for p in lpc if p["active"] != 1])
    print("quote suffix:", collections.Counter(p["symbol"].split("_", 1)[1] for p in lpc))
    for k in ("market", "feeMode", "makerFee", "takerFee", "markMethod", "mini", "followFundingRate", "profitSharing", "baseInterest", "quoteInterest", "fundingRateEx"):
        print(f"  {k}: {collections.Counter(str(p.get(k)) for p in lpc).most_common(6)}")
    print("  mini 1 symbols:", [p["symbol"] for p in lpc if p["mini"] == 1])
    intervals = collections.Counter((int(p["nextFundingTime"]) - int(p["prevFundingTime"])) // 1000 for p in lpc)
    print(f"  funding interval from nextFundingTime minus prevFundingTime, seconds: {dict(intervals)}")
    print("  1 h interval symbols:", [p["symbol"] for p in lpc if int(p["nextFundingTime"]) - int(p["prevFundingTime"]) == 3600000])
    bases = collections.Counter(p["symbol"].rsplit("_", 2)[0] for p in lpc)
    print(f"  base listed twice: {[b for b, n in bases.items() if n > 1]}")
    steps = collections.Counter(p["quantityIncrement"] for p in active)
    print(f"  quantityIncrement among active: {steps.most_common(6)}")
    st, h, body, dt, data = get_json(BASE + "/v1/products?market=lpc&symbol=BTC_USDT_SWAP")
    print(f"products filtered to one symbol: {st}, {len(body)} bytes, rows {len(data['result'])}")
    st, h, body, dt, data = get_json(BASE + "/v1/products")
    spot = data["result"]
    print(f"GET /api/v1/products (spot default): {len(spot)} rows, active {sum(1 for p in spot if p['active'] == 1)}, fees {collections.Counter((p['makerFee'], p['takerFee']) for p in spot).most_common(4)}")
    for m in ("forecast", "ipc", "lfc", "ifc", "swap", "futures"):
        st, h, body, dt, data = get_json(BASE + f"/v1/products?market={m}")
        rows = data.get("result") if isinstance(data, dict) else None
        print(f"market={m}: {st}, " + (f"{len(rows)} rows" if isinstance(rows, list) else body[:120]))
    return lpc


def anchor(lpc) -> None:
    section("3. anchor calls")
    st, h, body, dt, data = get_json(BASE + "/v1/pu/contracts")
    rows = data["result"]
    print(f"GET /api/v1/pu/contracts: {st}, {len(body)} bytes in {ms(dt)}, content-type {h.get('content-type')}, ktx-usage {h.get('ktx-usage')}, rows {len(rows)}, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, cache-control {h.get('cache-control')}, x-ratelimit {h.get('x-ratelimit-limit')}/{h.get('x-ratelimit-remaining')}/{h.get('x-ratelimit-reset')}")
    print("BTC row:", json.dumps(next(r for r in rows if r["ticker_id"] == "BTC_USDT_SWAP"), sort_keys=True))
    print(f"keys {sorted(rows[0])}")
    print(f"product_type {collections.Counter(r['product_type'] for r in rows)}, funding_interval {collections.Counter(r['funding_interval'] for r in rows)}")
    prod = {p["symbol"]: p for p in lpc}
    con = {r["ticker_id"]: r for r in rows}
    print(f"symbols only in products {sorted(set(prod) - set(con))}, only in contracts {sorted(set(con) - set(prod))}")
    st2, _, _, _, data2 = get_json(BASE + "/v1/products?market=lpc")
    prod = {p["symbol"]: p for p in data2["result"]}
    same_mark = [s for s in con if s in prod and prod[s]["markPrice"] == con[s]["index_price"]]
    diff = [s for s in con if s in prod and prod[s]["markPrice"] != con[s]["index_price"]]
    print(f"products markPrice equal to contracts index_price, read 1 s apart: {len(same_mark)} of {len(con)}")
    print(f"  differing: {len(diff)}, of which inactive {sum(1 for s in diff if prod[s]['active'] != 1)}")
    for s in diff[:8]:
        print(f"    {s} active {prod[s]['active']} markPrice {prod[s]['markPrice']} index_price {con[s]['index_price']}")
    print(f"fundingRate equal to contracts funding_rate: {sum(1 for s in con if prod[s]['fundingRate'] == con[s]['funding_rate'])} of {len(con)}")
    print(f"fundingRate equal to predictedFundingRate: {sum(1 for s in prod if prod[s]['fundingRate'] == prod[s]['predictedFundingRate'])} of {len(prod)}")
    print(f"nextFundingTime equal to next_funding_rate_timestamp: {sum(1 for s in con if prod[s]['nextFundingTime'] == con[s]['next_funding_rate_timestamp'])}")
    print(f"interval agreement: {sum(1 for s in con if (int(prod[s]['nextFundingTime']) - int(prod[s]['prevFundingTime'])) // 1000 == con[s]['funding_interval'])}")
    by_iv = collections.defaultdict(collections.Counter)
    for s, p in prod.items():
        if p["active"] == 1:
            by_iv[(int(p["nextFundingTime"]) - int(p["prevFundingTime"])) // 3600000][p["fundingRate"]] += 1
    for iv, c in sorted(by_iv.items()):
        print(f"  active {iv} h symbols, fundingRate values {c.most_common(5)}, total {sum(c.values())}")
    print(f"distinct nextFundingTime values {sorted(set(p['nextFundingTime'] for p in prod.values()))}")
    rates = [abs(float(p["fundingRate"])) for p in prod.values() if p["active"] == 1]
    print(f"largest absolute fundingRate among active: {max(rates)}")
    zero_bid = [s for s, r in con.items() if prod[s]["active"] == 1 and (float(r["bid"]) == 0 or float(r["ask"]) == 0)]
    print(f"active contracts with a zero bid or ask in the summary: {zero_bid}")


def poll() -> None:
    section(f"4. polls paced at one per second for {POLL_SECONDS} s, BTC_USDT_SWAP products row, with pu/contracts every 5th poll")
    marks, frs, preds, idx, ages, caches = [], [], [], [], [], collections.Counter()
    t_end = time.monotonic() + POLL_SECONDS
    n = 0
    while time.monotonic() < t_end:
        tick = time.monotonic()
        _, h, _, _, d = get_json(BASE + "/v1/products?market=lpc&symbol=BTC_USDT_SWAP")
        p = d["result"][0]
        caches[h.get("cf-cache-status")] += 1
        marks.append(p["markPrice"])
        frs.append(p["fundingRate"])
        preds.append(p["predictedFundingRate"])
        ages.append(time.time() - int(p["time"]) / 1000)
        if n % 5 == 0:
            _, hc, _, _, c = get_json(BASE + "/v1/pu/contracts")
            r = next(x for x in c["result"] if x["ticker_id"] == "BTC_USDT_SWAP")
            idx.append((r["index_price"], p["markPrice"], hc.get("cf-cache-status"), hc.get("x-ratelimit-remaining")))
        n += 1
        time.sleep(max(0.0, 1.0 - (time.monotonic() - tick)))

    def runs(xs):
        return sum(1 for a, b in zip(xs, xs[1:]) if a != b)

    print(f"polls {len(marks)}, cf-cache-status {dict(caches)}")
    print(f"markPrice changes {runs(marks)}, distinct {len(set(marks))}")
    print(f"fundingRate changes {runs(frs)}, values {sorted(set(frs))}")
    print(f"predictedFundingRate changes {runs(preds)}, values {sorted(set(preds))}")
    print(f"row time field age at read, s: median {statistics.median(ages):.1f} min {min(ages):.1f} max {max(ages):.1f}")
    print("pu/contracts index_price, products markPrice, contracts cf-cache-status, x-ratelimit-remaining:")
    for row in idx:
        print(f"  {row}")


def book() -> None:
    section("5. REST book")
    for level in (1, 5, 20, 100, 500, 1000):
        st, h, body, dt, d = get_json(BASE + f"/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&level={level}")
        r = d["result"]
        bp = [float(x[0]) for x in r["b"]]
        ap = [float(x[0]) for x in r["a"]]
        age = time.time() - int(r["t"]) / 1000
        print(f"level={level}: {st}, {len(r['b'])} bids {len(r['a'])} asks, {len(body)} bytes in {ms(dt)}, bids descending {bp == sorted(bp, reverse=True)}, asks ascending {ap == sorted(ap)}, i {r['i']!r}, book t {age:.1f} s old, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, cache-control {h.get('cache-control')}, ktx-usage {h.get('ktx-usage')}")
    section("5b. REST book through the Cloudflare cache, level=20 read three times, then with a cache-busting parameter")
    for q in ("", "", "", f"&_={int(time.time() * 1000)}", f"&_={int(time.time() * 1000) + 1}"):
        st, h, body, dt, d = get_json(BASE + f"/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&level=20{q}")
        r = d["result"]
        print(f"level=20{q}: book t {time.time() - int(r['t']) / 1000:.1f} s old, i {r['i']}, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, {ms(dt)}")
    st, h, body, dt, d = get_json(BASE + "/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP")
    print(f"no level: {len(d['result']['b'])} bids {len(d['result']['a'])} asks")
    for q in ("level=3", "level=2000", "price_scale=2&level=5"):
        st, h, body, dt = get(BASE + f"/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&{q}")
        print(f"{q}: {st} {body[:200]}")
    ids = []
    for _ in range(4):
        _, _, _, _, d = get_json(BASE + "/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&level=5")
        ids.append((d["result"]["i"], d["result"]["t"]))
    print(f"four reads 0.5 s apart, (i, t): {ids}")
    for q, label in (
        ("market=lpc&symbol=NOPE_USDT_SWAP&level=5", "unknown symbol"),
        ("market=lpc&symbol=EOS_USDT_SWAP&level=5", "inactive symbol"),
        ("market=lpc&symbol=BTC_USDT&level=5", "spot symbol under lpc"),
        ("symbol=BTC_USDT_SWAP&level=5", "swap symbol without market"),
        ("market=lpc&level=5", "missing symbol"),
    ):
        st, h, body, dt = get(BASE + f"/v1/order_book?{q}")
        print(f"{label}: {st} {body[:200]}")


def errors_and_limits() -> None:
    section("6. limits and error shapes")
    for path in ("/v1/ticker?market=lpc&symbol=BTC_USDT_SWAP", "/v1/pu/contracts", "/v1/pu/getPositionTierRules", "/v1/nope"):
        st, h, body, dt = get(BASE + path)
        print(f"{path}: {st}, ktx-usage {h.get('ktx-usage')}, retry-after {h.get('retry-after')}, ratelimit headers {[k for k in h if 'limit' in k]}, {len(body)} bytes in {ms(dt)}, body {body[:160]}")
    st, h, body, dt = get(BASE + "/v1/ticker?market=lpc&symbol=BTC_USDT_SWAP,ETH_USDT_SWAP")
    d = json.loads(body)
    print(f"ticker for two symbols: {st}, rows {len(d.get('result', []))}")
    st, h, body, dt = get(BASE + "/v1/ticker?market=lpc")
    print(f"ticker without symbol: {st} {body[:200]}")
    st, h, body, dt = get("/papi/v1/trade/accounts")
    print(f"private call without key, GET /papi/v1/trade/accounts: {st} {body[:200]}")


def server_time() -> None:
    section("7. server time")
    offsets = []
    for _ in range(5):
        t0 = time.time()
        _, _, body, _ = get(BASE + "/v1/time")
        t1 = time.time() - 0.5  # get() sleeps 0.5 s after reading
        server = int(json.loads(body)["result"]["time"]) / 1000
        offsets.append((server - (t0 + t1) / 2) * 1000)
    print(f"body shape {body}")
    print(f"offset server minus local, ms: {[round(x) for x in offsets]}, median {statistics.median(offsets):.0f}")


def main() -> None:
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    host_and_latency()
    lpc = catalog()
    anchor(lpc)
    book()
    errors_and_limits()
    server_time()
    poll()
    print(f"\nprobe end {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")


if __name__ == "__main__":
    main()
