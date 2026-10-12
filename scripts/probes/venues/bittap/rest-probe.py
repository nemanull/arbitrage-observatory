# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BitTap public REST probe for docs/profiles/bittap/.

Read-only and unauthenticated.
It sends about 40 requests at no more than 2 per second, well inside the documented 10 per second.
Run from the repository root with: uv run scripts/probes/venues/bittap/rest-probe.py
"""

import collections
import http.client
import json
import re
import socket
import ssl
import statistics
import time

OPENAPI = "openapi.bittap.com"  # documented "API URL", serves /fmapi
WEBAPI = "api.bittap.com"  # documented "Public URL", serves the website's own calls
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}

_conns: dict[str, http.client.HTTPSConnection] = {}


def get(host: str, path: str, fresh: bool = False):
    """GET over a kept-alive connection per host. Returns status, headers, body text, seconds."""
    if fresh or host not in _conns:
        if host in _conns:
            _conns[host].close()
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    t0 = time.perf_counter()
    try:
        conn.request("GET", path, headers=UA)
        resp = conn.getresponse()
        body = resp.read().decode("utf-8", "replace")
    except (http.client.HTTPException, OSError):
        conn.close()
        _conns.pop(host, None)
        return get(host, path, fresh=True)
    dt = time.perf_counter() - t0
    time.sleep(0.5)  # 2 requests per second at most
    return resp.status, dict(resp.getheaders()), body, dt


def get_json(host: str, path: str):
    status, headers, body, dt = get(host, path)
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        data = None
    return status, headers, body, dt, data


def section(title: str) -> None:
    print(f"\n=== {title}")


def host_latency() -> None:
    section("1. hosts and latency")
    for host in (OPENAPI, WEBAPI, "stream.bittap.com", "developers.bittap.com", "www.bittap.com"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"resolve failed: {e}"]
        print(f"{host}: {addrs}")
    for host, path in ((OPENAPI, "/fmapi/v1/ping"), (WEBAPI, "/api/v1/ping")):
        cold = []
        for _ in range(3):
            *_, dt = get(host, path, fresh=True)
            cold.append(dt)
        warm = []
        for _ in range(5):
            *_, dt = get(host, path)
            warm.append(dt)
        print(f"{host}{path}: cold (new TLS connection) median {statistics.median(cold) * 1000:.0f} ms {[round(x * 1000) for x in cold]}, warm median {statistics.median(warm) * 1000:.0f} ms {[round(x * 1000) for x in warm]}")


def server_time() -> None:
    section("7. server time and clock offset")
    for host, path in ((OPENAPI, "/fmapi/v1/time"), (WEBAPI, "/api/v1/time")):
        offsets = []
        for _ in range(3):
            t0 = time.time() * 1000
            status, _, body, _, data = get_json(host, path)
            t1 = time.time() * 1000
            server = data["data"] if isinstance(data, dict) and "data" in data else (data or {}).get("serverTime")
            offsets.append(server - (t0 + t1) / 2)
        print(f"{host}{path}: status {status}, body {body}, offset server minus local {[round(o) for o in offsets]} ms")
    status, _, body, _, _ = get_json(OPENAPI, "/fmapi/v1/ping")
    print(f"{OPENAPI}/fmapi/v1/ping: {status} {body}")
    status, _, body, _, _ = get_json(WEBAPI, "/api/v1/ping")
    print(f"{WEBAPI}/api/v1/ping: {status} {body}")
    for path in ("/fmapi/v1/exchangeInfo", "/fmapi/v1/time"):
        status, _, body, _, _ = get_json(WEBAPI, path)
        print(f"{WEBAPI}{path} (documented Public URL with the futures path): {status} {body[:160]}")


def catalog():
    section("2. catalog")
    status, headers, body, dt, data = get_json(OPENAPI, "/fmapi/v1/exchangeInfo")
    syms = data["data"]["symbols"]
    print(f"GET {OPENAPI}/fmapi/v1/exchangeInfo: {status}, {len(body)} bytes, {dt * 1000:.0f} ms, symbols {len(syms)}")
    print("  keys per symbol:", sorted(set().union(*[s.keys() for s in syms])))
    print("  contractSide x contractType:", dict(collections.Counter((s["contractSide"], s["contractType"]) for s in syms)))
    print("  data keys:", sorted(data["data"].keys()), "orderTypes", data["data"]["orderTypes"], "timeInForces", data["data"]["timeInForces"])

    status, headers, body, dt, web = get_json(WEBAPI, "/asset/public/v1/exchange/info")
    cs = web["data"]["contractSymbols"]
    ss = web["data"]["spotSymbols"]
    print(f"GET {WEBAPI}/asset/public/v1/exchange/info (website catalog): {status}, {len(body)} bytes, {dt * 1000:.0f} ms")
    print(f"  contractSymbols {len(cs)}, spotSymbols {len(ss)}, coins {len(web['data']['coins'])}")
    print("  contract keys:", sorted(set().union(*[s.keys() for s in cs])))
    print("  contract status:", dict(collections.Counter(s["status"] for s in cs)))
    print("  spot status:", dict(collections.Counter(s["status"] for s in ss)))
    live = [s for s in cs if s["status"] == "OPEN"]
    for key in ("contractSide", "contractType", "quoteCode", "multiplier", "settleCycle", "takerFeeRate", "makerFeeRate", "fundRateLimit", "liquidationFeeRate", "enableVipRate"):
        print(f"  OPEN by {key}:", dict(collections.Counter(str(s.get(key)) for s in live).most_common()))
    odd = [s["symbolId"] for s in live if not re.fullmatch(r"[A-Z0-9]+-USDT-M", s["symbolId"])]
    print("  OPEN symbolIds outside [A-Z0-9]+-USDT-M:", odd)
    print("  OPEN symbolName equals base+quote:", collections.Counter(s["symbolName"] == s["baseCode"] + s["quoteCode"] for s in live))
    print("  OPEN depths[0] equals priceStep:", collections.Counter(s["depths"][0] == s["priceStep"] for s in live))
    print("  OPEN takerFeeRate not 0.0006:", [(s["symbolId"], s["takerFeeRate"], s["makerFeeRate"]) for s in live if s["takerFeeRate"] != "0.0006"])
    print("  OPEN settleCycle 1:", [s["symbolId"] for s in live if s["settleCycle"] == 1])
    tradfi = {"XAU", "XAG", "TSLA", "MSTR", "NVDA", "COIN", "CRCL", "AAPL", "AMZN", "MSFT", "GOOGL", "QQQ", "META", "HOOD", "SPY"}
    print("  OPEN with a stock, index or metal ticker as base (name check, the catalog has no such tag):", [s["symbolId"] for s in live if s["baseCode"] in tradfi])
    print("  OPEN with a digit-leading base (a 1000x contract would show here):", [s["symbolId"] for s in live if s["baseCode"][:1].isdigit()])
    print("  duplicate baseCode among OPEN:", [b for b, n in collections.Counter(s["baseCode"] for s in live).items() if n > 1])
    print("  SETTLED sample:", [s["symbolId"] for s in cs if s["status"] != "OPEN"][:8])
    print("  indexSource sets:", dict(collections.Counter(",".join(sorted(s.get("indexSource") or [])) for s in live).most_common(5)))
    btc = next(s for s in cs if s["symbolId"] == "BTC-USDT-M")
    print("  BTC-USDT-M:", json.dumps({k: btc[k] for k in ("symbolId", "symbolName", "status", "multiplier", "priceStep", "depths", "minOrderQuantity", "quantityPrecision", "settleCycle", "fundRateLimit", "indexSymbolId", "indexSource", "takerFeeRate", "makerFeeRate", "liquidationFeeRate")}))
    open_ids = {s["symbolId"] for s in syms}
    web_ids = {s["symbolId"] for s in cs}
    print(f"  /fmapi symbol set equals website contract set: {open_ids == web_ids} (only fmapi {len(open_ids - web_ids)}, only website {len(web_ids - open_ids)})")
    return live, [s for s in cs if s["status"] != "OPEN"]


def fees() -> None:
    section("fees: VIP table the website's fee standard page reads")
    status, _, body, dt, data = get_json(WEBAPI, "/vip/public/api/v1/vip-config/getVipConfigInfo")
    print(f"GET {WEBAPI}/vip/public/api/v1/vip-config/getVipConfigInfo: {status}, {len(body)} bytes")
    for v in data["data"]:
        c, e = v["vipCondition"], v["vipEquity"]
        print(f"  {v['levelCode']} status {v['status']}: contract maker {e['contractMaker']} taker {e['contractTaker']}, spot maker {e['spotMaker']} taker {e['spotTaker']}; "
              f"conditions dayAsset {c['dayAsset']} thirtyAsset {c['thirtyAsset']} thirtyBTBAsset {c['thirtyBTBAsset']} thirtyContract {c['thirtyContract']} thirtySpot {c['thirtySpot']} thirtyInvite {c['thirtyInvite']}")


def books(live, settled) -> None:
    section("5. REST book")
    btc = next(s for s in live if s["symbolId"] == "BTC-USDT-M")
    for scale in btc["depths"]:
        status, _, body, dt, data = get_json(OPENAPI, f"/fmapi/v1/depth?symbolId=BTC-USDT-M&scale={scale}")
        d = data["data"]
        bids, asks = d["bids"], d["asks"]
        bid_desc = all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))
        ask_asc = all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))
        print(f"  scale {scale}: {status} {dt * 1000:.0f} ms e={d['e']} i={d['i']} lastUpdateId={d['lastUpdateId']} bids {len(bids)} asks {len(asks)} "
              f"bids descending {bid_desc} asks ascending {ask_asc} best {bids[0]} / {asks[0]} types {type(bids[0][0]).__name__}")
    for extra in ("&limit=5", "&limit=100", "&level=50"):
        status, _, body, dt, data = get_json(OPENAPI, f"/fmapi/v1/depth?symbolId=BTC-USDT-M&scale=0.1{extra}")
        d = (data or {}).get("data") or {}
        print(f"  scale 0.1{extra}: {status} levels {len(d.get('bids', []))}/{len(d.get('asks', []))} e={d.get('e')}")
    ids = []
    for _ in range(3):
        _, _, _, _, data = get_json(OPENAPI, "/fmapi/v1/depth?symbolId=BTC-USDT-M&scale=0.1")
        ids.append(data["data"]["lastUpdateId"])
    print(f"  three polls 0.5 s apart, lastUpdateId {ids}")
    for label, path in (
        ("scale missing", "/fmapi/v1/depth?symbolId=BTC-USDT-M"),
        ("scale not in depths", "/fmapi/v1/depth?symbolId=BTC-USDT-M&scale=0.5"),
        ("unknown symbol", "/fmapi/v1/depth?symbolId=NOPE-USDT-M&scale=0.1"),
        (f"SETTLED {settled[0]['symbolId']}", f"/fmapi/v1/depth?symbolId={settled[0]['symbolId']}&scale={settled[0]['depths'][0]}"),
        ("bookTicker BTC", "/fmapi/v1/ticker/bookTicker?symbolId=BTC-USDT-M"),
        ("bookTicker without symbol", "/fmapi/v1/ticker/bookTicker"),
        ("ticker/24hr BTC", "/fmapi/v1/ticker/24hr?symbolId=BTC-USDT-M"),
        ("ticker/24hr without symbol", "/fmapi/v1/ticker/24hr"),
        ("ticker/price BTC", "/fmapi/v1/ticker/price?symbolId=BTC-USDT-M"),
    ):
        status, headers, body, dt, _ = get_json(OPENAPI, path)
        print(f"  {label}: {status} {dt * 1000:.0f} ms {body[:260]}")
    # If amount / volume sits between the 24 h low and high, volume and book sizes are in base coin units.
    for sid in ("BTC-USDT-M", "DOGE-USDT-M", "PEPE-USDT-M"):
        if not any(s["symbolId"] == sid for s in live):
            continue
        _, _, _, _, data = get_json(OPENAPI, f"/fmapi/v1/ticker/24hr?symbolId={sid}")
        t = data["data"]
        vwap = float(t["amount"]) / float(t["volume"]) if float(t["volume"]) else None
        print(f"  unit check {sid}: amount/volume {vwap} against low {t['lowPrice']} high {t['highPrice']} close {t['closePrice']}")


def anchor_search(live) -> None:
    section("3. anchor: REST calls that might carry index, mark or funding")
    for path in (
        "/fmapi/v1/premiumIndex",
        "/fmapi/v1/premiumIndex?symbolId=BTC-USDT-M",
        "/fmapi/v1/fundingRate?symbolId=BTC-USDT-M",
        "/fmapi/v1/markPrice?symbolId=BTC-USDT-M",
        "/fmapi/v1/indexPrice?symbolId=BTC-USDT-M",
    ):
        status, _, body, dt, _ = get_json(OPENAPI, path)
        print(f"  {OPENAPI}{path}: {status} {body[:200]}")
    now = int(time.time() * 1000)
    for path in (
        f"/mark/kline/api/v1/mark/klines?symbolId=BTC-USDT-M&interval=1m&limit=2&endTime={now}",
        f"/index/kline/api/v1/index/klines?symbolId=BTC-USDT&interval=1m&limit=2&endTime={now}",
        f"/index/kline/api/v1/index/klines?symbolId=BTC-USDT-M&interval=1m&limit=2&endTime={now}",
        "/mark/kline/api/v1/mark/klines?interval=1m&limit=2",
    ):
        status, _, body, dt, _ = get_json(WEBAPI, path)
        print(f"  {WEBAPI}{path}: {status} {dt * 1000:.0f} ms {body[:300]}")


def limits_and_access() -> None:
    section("6. rate limit headers, error shapes and access")
    status, headers, body, dt, _ = get_json(OPENAPI, "/fmapi/v1/ticker/price?symbolId=ETH-USDT-M")
    print(f"  response headers of a /fmapi call: {sorted(headers)}")
    print(f"  rate limit headers: {[h for h in headers if 'limit' in h.lower() or 'retry' in h.lower() or 'weight' in h.lower()]}")
    status, headers, body, dt, _ = get_json(OPENAPI, "/fmapi/v1/nope")
    print(f"  unknown path on {OPENAPI}: {status} {body[:200]}")
    status, headers, body, dt, _ = get_json(WEBAPI, "/ucenter/public/api/v1/compliance/check")
    print(f"  {WEBAPI}/ucenter/public/api/v1/compliance/check (website region check, IP blanked): {status} {re.sub(r'[0-9]+[.][0-9]+[.][0-9]+[.][0-9]+', 'x.x.x.x', body)}")


def main() -> None:
    print("BitTap REST probe, local time", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    host_latency()
    server_time()
    live, settled = catalog()
    fees()
    books(live, settled)
    anchor_search(live)
    limits_and_access()


if __name__ == "__main__":
    main()
