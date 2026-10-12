# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Picol public REST probe for docs/profiles/picol/rest.md and fees.md.

Read-only and unauthenticated.
Picol publishes no API documentation, so the calls below are the Pionex open API shapes, sent to api.picol.com.
The same calls go to api.pionex.com side by side, to test whether the two hosts serve one catalog and one book.
It sends about 265 requests over about two and a half minutes, at most about 3 per second per host, inside the 10 per second IP budget Pionex documents.
Run from the repository root with: uv run scripts/probes/venues/picol/rest-probe.py
"""

import collections
import concurrent.futures
import http.client
import json
import socket
import ssl
import statistics
import time

PICOL = "api.picol.com"
PIONEX = "api.pionex.com"
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json", "Accept-Encoding": "identity"}
POLL_SECONDS = 60

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(host: str, path: str, keep: bool = True, pause: float = 0.35):
    """One GET. Returns status, lowercased headers, body text and seconds."""
    if not keep or host not in _conns:
        if host in _conns:
            _conns.pop(host).close()
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
        return get(host, path, keep=False, pause=pause)
    dt = time.perf_counter() - t0
    if pause:
        time.sleep(pause)
    return resp.status, {k.lower(): v for k, v in resp.getheaders()}, body, dt


def get_json(host: str, path: str, **kw):
    status, headers, body, dt = get(host, path, **kw)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    return status, headers, body, dt, data


def one_shot(host: str, path: str):
    """A GET on its own fresh connection, for simultaneous pairs."""
    conn = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    t0 = time.time()
    conn.request("GET", path, headers=UA)
    resp = conn.getresponse()
    body = resp.read().decode("utf-8", "replace")
    conn.close()
    return t0, time.time(), json.loads(body)


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def site_access() -> None:
    section("Site access")
    for host, path in [
        ("www.picol.com", "/en"),
        ("www.picol.com", "/en/fees"),
        ("www.picol.com", "/docs/"),
        ("www.picol.com", "/blog/en/picol-terms-of-service/"),
        ("www.picol.com", "/static/html/picol_login_protocol_service.html"),
        ("config.picol.com", "/vipLevelConfig.picol.json"),
        ("api.picol.com", "/"),
    ]:
        status, headers, body, dt = get(host, path, keep=False)
        print(f"{host}{path}: {status}, {len(body)} chars, server {headers.get('server')}, x-cache {headers.get('x-cache')}, {dt * 1000:.0f} ms")
    try:
        socket.getaddrinfo("support.picol.com", 443)
        print("support.picol.com resolves")
    except socket.gaierror as exc:
        print(f"support.picol.com does not resolve: {exc}")


def host_latency() -> None:
    section("Host and latency")
    for host in (PICOL, "ws.picol.com", PIONEX):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        print(f"{host} resolves to {addrs}")
    path = "/api/v1/market/indexes"
    cold = []
    for _ in range(3):
        status, headers, body, dt = get(PICOL, path, keep=False)
        cold.append(dt * 1000)
    print(f"cold indexes, new TLS connection each: {[round(x) for x in cold]} ms, {len(body)} bytes, via {headers.get('via')}, x-cache {headers.get('x-cache')}, pop {headers.get('x-amz-cf-pop')}")
    warm = []
    for _ in range(10):
        status, headers, body, dt = get(PICOL, path, pause=0.5)
        warm.append(dt * 1000)
    print(f"warm indexes over 10: min {min(warm):.0f}, median {statistics.median(warm):.0f}, max {max(warm):.0f} ms")
    print(f"headers on indexes: { {k: v for k, v in headers.items() if k.startswith('x-') or k in ('server', 'content-type', 'content-encoding')} }")
    conn = http.client.HTTPSConnection(PICOL, 443, timeout=20, context=CTX)
    conn.request("GET", path, headers={**UA, "Accept-Encoding": "gzip"})
    resp = conn.getresponse()
    gz = resp.read()
    print(f"gzip asked: content-encoding {resp.getheader('content-encoding')}, {len(gz)} bytes on the wire")
    conn.close()


def counts(rows):
    fam = collections.Counter()
    for r in rows:
        s = r["symbol"]
        if s.startswith("USDT_"):
            fam["USDT_<COIN>_PERP"] += 1
        else:
            fam[r["quoteCurrency"]] += 1
    return dict(fam)


def catalog():
    section("Catalog")
    out = {}
    for host in (PICOL, PIONEX):
        status, headers, body, dt, data = get_json(host, "/api/v1/common/symbols?type=PERP")
        rows = data["data"]["symbols"]
        st = collections.Counter(r["status"] for r in rows)
        print(f"{host} PERP: HTTP {status}, {len(rows)} rows, {len(body)} bytes, {dt * 1000:.0f} ms, status {dict(st)}, families {counts(rows)}, x-ratelimit-tokens {headers.get('x-ratelimit-tokens')}")
        status, headers, body, dt, sdata = get_json(host, "/api/v1/common/symbols")
        srows = sdata["data"]["symbols"]
        en = sum(1 for r in srows if r.get("enable"))
        sq = collections.Counter(r["quoteCurrency"] for r in srows)
        print(f"{host} SPOT (no type): {len(srows)} rows, {en} enabled, quotes {dict(sq.most_common(6))}")
        out[host] = (rows, srows)
    a, b = out[PICOL][0], out[PIONEX][0]
    sa, sb = {r["symbol"]: r for r in a}, {r["symbol"]: r for r in b}
    print(f"PERP symbols only on Picol: {sorted(set(sa) - set(sb))}, only on Pionex: {sorted(set(sb) - set(sa))}")
    diff = [s for s in sa if s in sb and sa[s] != sb[s]]
    print(f"PERP rows in both whose fields differ: {len(diff)} {diff[:5]}")
    ssa, ssb = {r["symbol"] for r in out[PICOL][1]}, {r["symbol"] for r in out[PIONEX][1]}
    print(f"SPOT symbols only on Picol: {len(ssa - ssb)} {sorted(ssa - ssb)[:10]}, only on Pionex: {len(ssb - ssa)} {sorted(ssb - ssa)[:10]}")
    print("BTC_USDT_PERP row on Picol:", json.dumps(sa["BTC_USDT_PERP"], separators=(",", ":")))
    nonascii = [s for s in sa if not s.isascii()]
    print(f"non-ASCII symbols: {nonascii}")
    bases = collections.Counter(r["baseCurrency"] for r in a if r["quoteCurrency"] == "USDT" and not r["symbol"].startswith("USDT_"))
    print(f"USDT-M bases listed twice: {[k for k, v in bases.items() if v > 1]}")
    renamed = [(r["symbol"], r["baseCurrency"]) for r in a if r["quoteCurrency"] == "USDT" and not r["symbol"].startswith("USDT_") and r["symbol"].split("_")[0] != r["baseCurrency"]]
    print(f"USDT-M symbols whose prefix differs from baseCurrency: {len(renamed)} {renamed[:8]}")
    return sa


def anchor(sa) -> None:
    section("Anchor bulk call")
    status, headers, body, dt, data = get_json(PICOL, "/api/v1/market/indexes")
    rows = data["data"]["indexes"]
    ts = data.get("timestamp")
    zero_mark = [r["symbol"] for r in rows if float(r["markPrice"]) == 0]
    print(f"Picol indexes: {len(rows)} rows, {len(body)} bytes, {dt * 1000:.0f} ms, zero marks {zero_mark}, reply timestamp {ts}")
    print(f"perps without an indexes row: {sorted(set(sa) - {r['symbol'] for r in rows})}")
    ages = [ts - r["updateTime"] for r in rows if ts]
    print(f"updateTime age against reply timestamp: min {min(ages)}, median {statistics.median(ages)}, max {max(ages)} ms")
    nft = collections.Counter(time.strftime("%H:%M", time.gmtime(r["nextFundingTime"] / 1000)) for r in rows)
    print(f"nextFundingTime groups UTC: {dict(nft)}")
    btc = next(r for r in rows if r["symbol"] == "BTC_USDT_PERP")
    print("BTC_USDT_PERP row:", json.dumps(btc, separators=(",", ":")))

    section("Anchor against Pionex, fetched at the same moment")
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        fa = ex.submit(one_shot, PICOL, "/api/v1/market/indexes")
        fb = ex.submit(one_shot, PIONEX, "/api/v1/market/indexes")
        (a0, a1, ja), (b0, b1, jb) = fa.result(), fb.result()
    ra = {r["symbol"]: r for r in ja["data"]["indexes"]}
    rb = {r["symbol"]: r for r in jb["data"]["indexes"]}
    both = set(ra) & set(rb)
    same_ut = [s for s in both if ra[s]["updateTime"] == rb[s]["updateTime"]]
    same_all = [s for s in same_ut if ra[s] == rb[s]]
    print(f"rows Picol {len(ra)}, Pionex {len(rb)}, in both {len(both)}, same updateTime {len(same_ut)}, identical where updateTime matches {len(same_all)} of {len(same_ut)}")
    fields = collections.Counter(f for s in same_ut for f in ra[s] if ra[s][f] != rb[s][f])
    print(f"fields that differ in rows with the same updateTime: {dict(fields)}")
    rate_eq = sum(1 for s in both if ra[s]["nextFundingRate"] == rb[s]["nextFundingRate"])
    nft_eq = sum(1 for s in both if ra[s]["nextFundingTime"] == rb[s]["nextFundingTime"])
    print(f"same nextFundingRate on {rate_eq}, same nextFundingTime on {nft_eq} of {len(both)}")

    section("Funding interval from the funding history")
    sample = ["BTC_USDT_PERP", "ETH_USDT_PERP", "SOL_USDT_PERP", "ACE_USDT_PERP", "AAX_USDT_PERP", "BTC_ETH_PERP", "USDT_BTC_PERP"]
    for s in sample:
        res = {}
        for host in (PICOL, PIONEX):
            status, headers, body, dt, d = get_json(host, f"/api/v1/market/fundingRates?symbol={s}&limit=3")
            fr = d["data"].get("rates") if d and d.get("result") else None
            if not fr:
                res[host] = body[:160]
                continue
            times = [x["fundingTime"] for x in fr]
            gaps = [round((times[i] - times[i + 1]) / 3600000, 2) for i in range(len(times) - 1)]
            res[host] = (gaps, fr[0]["fundingRate"], fr[0]["fundingTime"])
        same = "same" if res[PICOL] == res[PIONEX] else "different"
        print(f"{s}: Picol gaps in hours, last rate, last time {res[PICOL]}, Pionex {same}")


def change_rate() -> None:
    section(f"How often the anchor numbers change, one second polls for {POLL_SECONDS} s")
    watch = ["BTC_USDT_PERP", "ETH_USDT_PERP", "SOL_USDT_PERP"]
    prev = None
    changed = collections.defaultdict(lambda: collections.Counter())
    per_poll = collections.defaultdict(list)
    times = []
    n = 0
    t_end = time.time() + POLL_SECONDS
    while time.time() < t_end:
        t0 = time.time()
        status, headers, body, dt, d = get_json(PICOL, "/api/v1/market/indexes", pause=0)
        times.append(dt * 1000)
        rows = {r["symbol"]: r for r in d["data"]["indexes"]}
        if prev:
            n += 1
            for f in ("indexPrice", "markPrice", "nextFundingRate", "nextFundingTime", "updateTime"):
                c = sum(1 for s in rows if s in prev and rows[s][f] != prev[s][f])
                per_poll[f].append(c)
                for s in watch:
                    if rows[s][f] != prev[s][f]:
                        changed[f][s] += 1
        prev = rows
        time.sleep(max(0, 1 - (time.time() - t0)))
    print(f"{n} intervals, reply time min {min(times):.0f}, median {statistics.median(times):.0f}, max {max(times):.0f} ms, last x-ratelimit-tokens {headers.get('x-ratelimit-tokens')}")
    for f, v in per_poll.items():
        print(f"{f}: rows changed per poll median {statistics.median(v)}, min {min(v)}, max {max(v)}, watched {dict(changed[f])}")


def depth_and_book() -> None:
    section("REST book snapshot")
    for lim in (20, 100, 1000):
        status, headers, body, dt, d = get_json(PICOL, f"/api/v1/market/depth?symbol=BTC_USDT_PERP&limit={lim}")
        bids, asks = d["data"]["bids"], d["data"]["asks"]
        bo = all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))
        ao = all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))
        print(f"limit {lim}: {len(bids)} bids, {len(asks)} asks, bids descending {bo}, asks ascending {ao}, {len(body)} bytes, {dt * 1000:.0f} ms, age {d['timestamp'] - d['data']['updateTime']} ms")
    status, headers, body, dt, d = get_json(PICOL, "/api/v1/market/bookTickers?type=PERP")
    print(f"bookTickers PERP: {len((d or {}).get('data', {}).get('tickers') or [])} rows, {len(body)} bytes")

    section("Book against Pionex, simultaneous pairs")
    for sym in ("BTC_USDT_PERP", "ETH_USDT_PERP", "SOL_USDT_PERP", "DOGE_USDT_PERP", "BTC_USDT", "ETH_USDT"):
        same_ut = ladder = 0
        ratios = []
        for _ in range(5):
            with concurrent.futures.ThreadPoolExecutor(2) as ex:
                fa = ex.submit(one_shot, PICOL, f"/api/v1/market/depth?symbol={sym}&limit=20")
                fb = ex.submit(one_shot, PIONEX, f"/api/v1/market/depth?symbol={sym}&limit=20")
                (_, _, ja), (_, _, jb) = fa.result(), fb.result()
            da, db = ja["data"], jb["data"]
            time.sleep(0.7)
            if da["updateTime"] != db["updateTime"]:
                continue
            same_ut += 1
            la, lb = da["bids"] + da["asks"], db["bids"] + db["asks"]
            ladder += [x[0] for x in la] == [x[0] for x in lb]
            ratios += [float(x[1]) / float(y[1]) for x, y in zip(la, lb) if x[0] == y[0] and float(y[1]) > 0]
        r = f"min {min(ratios):.4f}, median {statistics.median(ratios):.4f}, max {max(ratios):.4f} over {len(ratios)} levels" if ratios else "none"
        print(f"{sym}: 5 pairs, same updateTime {same_ut}, same price ladder in those {ladder}, Picol size over Pionex size {r}")
    print("one Picol depth reply, trimmed:", json.dumps({**da, "bids": da["bids"][:3], "asks": da["asks"][:3]}, separators=(",", ":")))

    section("Trades against Pionex")
    for sym in ("BTC_USDT_PERP", "ETH_USDT_PERP"):
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            fa = ex.submit(one_shot, PICOL, f"/api/v1/market/trades?symbol={sym}&limit=50")
            fb = ex.submit(one_shot, PIONEX, f"/api/v1/market/trades?symbol={sym}&limit=50")
            (_, _, ja), (_, _, jb) = fa.result(), fb.result()
        ta = {t["tradeId"]: t for t in ja["data"]["trades"]}
        tb = {t["tradeId"]: t for t in jb["data"]["trades"]}
        both = set(ta) & set(tb)
        same_px = sum(1 for i in both if ta[i]["price"] == tb[i]["price"] and ta[i]["timestamp"] == tb[i]["timestamp"] and ta[i]["side"] == tb[i]["side"])
        ratios = [float(ta[i]["size"]) / float(tb[i]["size"]) for i in both if float(tb[i]["size"]) >= 0.01]
        print(f"{sym}: Picol {len(ta)} trades, Pionex {len(tb)}, same tradeId {len(both)}, same price, time and side {same_px}, size ratio median {statistics.median(ratios):.4f} over {len(ratios)} trades")
        first = ja["data"]["trades"][0]
        print(f"  Picol {json.dumps(first, separators=(',', ':'))}")
        print(f"  Pionex {json.dumps(tb[first['tradeId']], separators=(',', ':'))}" if first["tradeId"] in tb else "  not on Pionex")
        time.sleep(0.7)


def quotation() -> None:
    section("Documented quotation API on www.picol.com")
    for path in [
        "/quotation/order_book?base=BTC.PERP&quote=USDT&limit=150",
        "/quotation/order_book?base=BTC.PERP&quote=USDT&limit=151",
        "/quotation/order_book?base=BTC&quote=USDT&limit=5",
        "/quotation/order_book?base=NOPE.PERP&quote=USDT&limit=5",
        "/quotation/ticker?base=BTC.PERP&quote=USDT",
        "/quotation/ticker",
        "/quotation/trades_history?base=BTC.PERP&quote=USDT",
        "/quotation/tickers",
    ]:
        status, headers, body, dt, d = get_json("www.picol.com", path)
        data = (d or {}).get("data")
        if isinstance(data, dict) and "bids" in data:
            info = f"{len(data['bids'])} bids, {len(data['asks'])} asks, timestamp {data['timestamp']}, top bid {data['bids'][:1]}"
        elif isinstance(data, dict) and "items" in data:
            info = f"{len(data['items'])} trades, first {json.dumps(data['items'][0], separators=(',', ':'))}"
        else:
            info = body[:260]
        print(f"{path}: HTTP {status}, {dt * 1000:.0f} ms, x-cache {headers.get('x-cache')}, {info}")
    ratios = []
    for _ in range(3):
        with concurrent.futures.ThreadPoolExecutor(2) as ex:
            fa = ex.submit(one_shot, "www.picol.com", "/quotation/order_book?base=ETH.PERP&quote=USDT&limit=20")
            fb = ex.submit(one_shot, PIONEX, "/api/v1/market/depth?symbol=ETH_USDT_PERP&limit=20")
            (_, _, ja), (_, _, jb) = fa.result(), fb.result()
        la = ja["data"]["bids"] + ja["data"]["asks"]
        lb = jb["data"]["bids"] + jb["data"]["asks"]
        pb = {x[0].rstrip("0").rstrip("."): float(x[1]) for x in lb}
        ratios += [float(x[1]) / pb[x[0].rstrip("0").rstrip(".")] for x in la if x[0].rstrip("0").rstrip(".") in pb and pb[x[0].rstrip("0").rstrip(".")] >= 0.01]
        time.sleep(0.7)
    if ratios:
        print(f"quotation ETH.PERP size over api.pionex.com ETH_USDT_PERP size at the same price: min {min(ratios):.4f}, median {statistics.median(ratios):.4f}, max {max(ratios):.4f} over {len(ratios)} levels")


def limits_and_errors() -> None:
    section("Rate limit headers and errors")
    for path in [
        "/api/v1/market/depth?symbol=NOPE_USDT_PERP",
        "/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=2000",
        "/api/v1/market/indexes?symbol=NOPE_USDT_PERP",
        "/api/v1/market/fundingRates?symbol=BTC_USDT",
        "/api/v1/common/symbols?type=FUTURES",
        "/api/v1/market/bookTicker?type=PERP",
        "/api/v1/common/timestamp",
        "/api/v1/nope",
    ]:
        status, headers, body, dt = get(PICOL, path)
        print(f"{path}: HTTP {status}, tokens {headers.get('x-ratelimit-tokens')}, {body[:150]}")
    toks = []
    for _ in range(4):
        status, headers, body, dt = get(PICOL, "/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=5", pause=0.3)
        toks.append((headers.get("x-ratelimit-tokens"), headers.get("x-ratelimit-last")))
    print(f"depth calls 0.3 s apart, tokens and last: {toks}")
    status, headers, body, dt = get(PICOL, "/api/v1/common/symbols?type=PERP")
    print(f"catalog call after them, tokens {headers.get('x-ratelimit-tokens')}")

    section("Server time")
    offs, rtts = [], []
    for _ in range(10):
        t0 = time.time()
        status, headers, body, dt, d = get_json(PICOL, "/api/v1/market/depth?symbol=BTC_USDT_PERP&limit=1", pause=0)
        t1 = time.time()
        time.sleep(0.4)
        offs.append(d["timestamp"] - (t0 + t1) / 2 * 1000)
        rtts.append((t1 - t0) * 1000)
    print(f"reply timestamp minus local midpoint: min {min(offs):.0f}, median {statistics.median(offs):.0f}, max {max(offs):.0f} ms, round trip median {statistics.median(rtts):.0f} ms")


def main() -> None:
    print(f"run at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")
    site_access()
    host_latency()
    sa = catalog()
    anchor(sa)
    depth_and_book()
    quotation()
    limits_and_errors()
    change_rate()
    print(f"\ndone at {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())} UTC")


if __name__ == "__main__":
    main()
