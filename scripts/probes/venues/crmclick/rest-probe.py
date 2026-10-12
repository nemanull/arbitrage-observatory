# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CRMClick public REST probe for docs/profiles/crmclick/rest.md.

Public, unauthenticated and read-only.
The host is api.crmclick.io, the base URL of the crmclick.io web app bundle.
CRMClick publishes no rate limit, so this probe sends about 45 requests to it over about 2 minutes, never faster than one a second.
It also reads HTX's public REST once per paired CRMClick read, to test whether CRMClick relays HTX's books.
Run from the repository root with: uv run scripts/probes/venues/crmclick/rest-probe.py
"""

import collections
import email.utils
import gzip
import http.client
import json
import socket
import ssl
import statistics
import time
import urllib.parse

CRM = "api.crmclick.io"
HBDM = "api.hbdm.com"
HTX_SPOT = "api.huobi.pro"
CMC = "api.coinmarketcap.com"
CTX = ssl.create_default_context()
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json", "XX-Device-Type": "web"}
PACE = 1.0

_conns: dict[str, http.client.HTTPSConnection] = {}


def req(host: str, method: str, path: str, form: dict | None = None, fresh: bool = False):
    """One request over a kept-alive connection per host. Returns status, headers, text, seconds."""
    if fresh and host in _conns:
        _conns.pop(host).close()
    if host not in _conns:
        _conns[host] = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    conn = _conns[host]
    headers = dict(UA)
    body = None
    if form is not None:
        body = urllib.parse.urlencode(form)
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    t0 = time.perf_counter()
    try:
        conn.request(method, path, body=body, headers=headers)
        resp = conn.getresponse()
        raw = resp.read()
    except (http.client.HTTPException, OSError):
        _conns.pop(host).close()
        if fresh:
            raise
        return req(host, method, path, form, fresh=True)
    secs = time.perf_counter() - t0
    hdrs = {k.lower(): v for k, v in resp.getheaders()}
    if hdrs.get("content-encoding") == "gzip":
        raw = gzip.decompress(raw)
    return resp.status, hdrs, raw.decode("utf-8", "replace"), secs


def crm(method: str, path: str, form: dict | None = None, fresh: bool = False):
    out = req(CRM, method, f"/{path}?lang=en-us", form, fresh)
    time.sleep(PACE)
    return out


def head(text: str, n: int = 220) -> str:
    return text[:n].replace("\n", " ")


def section(title: str):
    print(f"\n== {title}")


def host_and_latency():
    section("1. host and latency")
    infos = socket.getaddrinfo(CRM, 443, proto=socket.IPPROTO_TCP)
    print("resolved:", sorted({i[4][0] for i in infos}))
    cold = []
    for _ in range(3):
        s, h, t, secs = crm("GET", "futures/market", fresh=True)
        cold.append(secs)
    warm = []
    for _ in range(5):
        s, h, t, secs = crm("GET", "futures/market")
        warm.append(secs)
    print(f"futures/market cold (new TLS) s: {[round(x, 3) for x in cold]}, median {statistics.median(cold):.3f}")
    print(f"futures/market warm s: {[round(x, 3) for x in warm]}, median {statistics.median(warm):.3f}, bytes {len(t)}")
    print("server, cf-ray:", h.get("server"), h.get("cf-ray"))
    print("rate limit headers:", {k: v for k, v in h.items() if "limit" in k or "retry" in k} or "none")


def catalog():
    section("2. catalog")
    s, h, t, secs = crm("GET", "spot/market")
    spot = json.loads(t)["data"]
    print(f"GET spot/market: {s}, {len(t)} bytes, {secs:.3f}s, count {spot['count']}, rows {len(spot['list'])}")
    rows = spot["list"]
    print("  platform:", dict(collections.Counter(r["platform"] for r in rows)))
    print("  quote:", dict(collections.Counter(r["money"] for r in rows)))
    print("  tradeStatus:", dict(collections.Counter(r["tradeStatus"] for r in rows)))
    print("  maker_fee, taker_fee:", dict(collections.Counter((r["maker_fee"], r["taker_fee"]) for r in rows)))
    print("  matched (platform match), 24h base volume:", [(r["market"], r["tickerData"]["volume"]) for r in rows if r["platform"] == "match"])
    print("  matched markets with zero 24h volume:", sum(1 for r in rows if r["platform"] == "match" and float(r["tickerData"]["volume"]) == 0))
    dup = [k for k, v in collections.Counter(r["market"] for r in rows).items() if v > 1]
    print("  markets listed twice:", dup or "none")
    print("  row keys:", sorted(rows[0].keys()))

    s, h, t, secs = crm("GET", "futures/market")
    fut = json.loads(t)["data"]
    frows = fut["list"]
    print(f"GET futures/market: {s}, {len(t)} bytes, {secs:.3f}s, count {fut['count']}, rows {len(frows)}")
    print("  platform:", dict(collections.Counter(r["platform"] for r in frows)))
    print("  quote:", dict(collections.Counter(r["money"] for r in frows)))
    print("  huobi_contract_size values:", dict(collections.Counter(r["huobi_contract_size"] for r in frows).most_common(6)))
    print("  fee fields present:", [k for k in frows[0] if "fee" in k] or "none")
    print("  funding, mark or index fields present:", [k for k in frows[0] if any(w in k.lower() for w in ("fund", "markp", "mark_", "index"))] or "none")
    print("  markets:", [r["market"] for r in frows])
    print("  row keys:", sorted(frows[0].keys()))
    return frows


def htx_contracts():
    s, h, t, secs = req(HBDM, "GET", "/linear-swap-api/v1/swap_contract_info?business_type=swap")
    d = json.loads(t)["data"]
    time.sleep(PACE)
    return {c["contract_code"].replace("-", ""): c for c in d}


def anchor(frows):
    section("3. anchor")
    s, h, t, secs = req(CRM, "GET", "/futures/huobiMarketPatch?lang=en-us&symbol=BTCUSDT")
    time.sleep(PACE)
    print(f"GET futures/huobiMarketPatch?symbol=BTCUSDT (the trade page's funding call): {s} {head(t)}")
    s, h, t, secs = crm("POST", "futures/huobiMarketPatch", {"symbol": "BTCUSDT"})
    print(f"POST futures/huobiMarketPatch symbol=BTCUSDT: {s} {head(t)}")
    for guess in ("futures/fundingRate", "futures/premiumIndex", "futures/markPrice", "futures/index"):
        s, h, t, secs = crm("GET", guess)
        print(f"GET {guess}: {s} {head(t, 160)}")
    print("contract size against HTX:")
    contracts = htx_contracts()
    same = diff = missing = 0
    for r in frows:
        c = contracts.get(r["market"])
        if not c:
            missing += 1
            continue
        if float(r["huobi_contract_size"]) == float(c["contract_size"]):
            same += 1
        else:
            diff += 1
    print(f"  huobi_contract_size equals HTX swap_contract_info contract_size on {same}, differs on {diff}, absent from HTX on {missing}")


def book_compare(n: int = 5):
    section("4. futures book against HTX linear swap")
    for i in range(n):
        s, h, t, secs = req(CRM, "POST", "/futures/depth?lang=en-us", {"symbol": "BTCUSDT", "limit": 20})
        crm_d = json.loads(t)["data"]
        s2, h2, t2, secs2 = req(HBDM, "GET", "/linear-swap-ex/market/depth?contract_code=BTC-USDT&type=step0")
        htx = json.loads(t2)["tick"]
        cb, ca = crm_d["bids"], crm_d["asks"]
        hb, ha = htx["bids"], htx["asks"]
        hb_prices = {p for p, _ in hb}
        ha_prices = {p for p, _ in ha}
        bid_hit = sum(1 for p, _ in cb if p in hb_prices)
        ask_hit = sum(1 for p, _ in ca if p in ha_prices)
        print(f"  pair {i + 1}: CRM levels {len(cb)}/{len(ca)} best {cb[0]} {ca[0]} lastUpdateId {crm_d.get('lastUpdateId')} E {crm_d.get('E')}"
              f" | HTX levels {len(hb)}/{len(ha)} best {hb[0]} {ha[0]} | CRM prices found in HTX book: bids {bid_hit}/{len(cb)} asks {ask_hit}/{len(ca)}")
        time.sleep(2)


def spot_compare():
    section("5. spot books")
    s, h, t, secs = req(CRM, "POST", "/spot/depth?lang=en-us", {"symbol": "BTCUSDT", "limit": 20})
    d = json.loads(t)["data"]
    s2, h2, t2, secs2 = req(HTX_SPOT, "GET", "/market/depth?symbol=btcusdt&type=step0&depth=20")
    htx = json.loads(t2)["tick"]
    print(f"  CRM spot BTCUSDT best {d['bids'][0]} {d['asks'][0]} levels {len(d['bids'])}/{len(d['asks'])} | HTX spot best {htx['bids'][0]} {htx['asks'][0]}")
    print(f"  CRM spot BTCUSDT bids 2 to 6: {d['bids'][1:6]}")
    time.sleep(PACE)
    for limit in (5, 20, 100, 500):
        s, h, t, secs = crm("POST", "spot/depth", {"symbol": "ARCBUSDT", "limit": limit})
        dd = json.loads(t).get("data") or {}
        print(f"  spot/depth ARCBUSDT limit {limit}: {s} levels {len(dd.get('bids', []))}/{len(dd.get('asks', []))} best {dd.get('bids', [None])[:1]} {dd.get('asks', [None])[:1]} lastUpdateId {dd.get('lastUpdateId')}")
    for limit in (5, 20, 100, 500):
        s, h, t, secs = crm("POST", "futures/depth", {"symbol": "ETHUSDT", "limit": limit})
        dd = json.loads(t).get("data") or {}
        print(f"  futures/depth ETHUSDT limit {limit}: {s} levels {len(dd.get('bids', []))}/{len(dd.get('asks', []))}")
    print("  caching, four futures/depth BTCUSDT reads one second apart:")
    for _ in range(4):
        s, h, t, secs = crm("POST", "futures/depth", {"symbol": "BTCUSDT", "limit": 5})
        dd = json.loads(t)["data"]
        print(f"    E {dd.get('E')} best bid {dd['bids'][0]} cf-cache-status {h.get('cf-cache-status')}")


def errors():
    section("6. error shapes")
    cases = [
        ("POST", "futures/depth", {"symbol": "BTCUSDT"}),
        ("POST", "futures/depth", {"symbol": "NOSUCHUSDT", "limit": 5}),
        ("POST", "spot/depth", {"symbol": "NOSUCHUSDT", "limit": 5}),
        ("GET", "spot/depth", None),
        ("POST", "futuresOrder/openFuturesOrders", {}),
        ("GET", "no/such/path", None),
    ]
    for method, path, form in cases:
        s, h, t, secs = crm(method, path, form)
        print(f"  {method} {path} {form}: HTTP {s} {head(t, 200)}")


def server_time():
    section("7. server time")
    for _ in range(3):
        before = time.time()
        s, h, t, secs = crm("POST", "futures/depth", {"symbol": "BTCUSDT", "limit": 5})
        after = time.time()
        mid = (before + after) / 2
        e_ms = json.loads(t)["data"].get("E")
        date = email.utils.parsedate_to_datetime(h["date"]).timestamp()
        print(f"  futures/depth E {e_ms}, E minus local midpoint {(e_ms / 1000 - mid) * 1000:.0f} ms, Date header minus midpoint {date - mid:.1f} s, round trip {secs * 1000:.0f} ms")
    s, h, t, secs = crm("GET", "common/time")
    print(f"  GET common/time: {s} {head(t, 160)}")


def cmc():
    section("8. CoinMarketCap record")
    s, h, t, secs = req(CMC, "GET", "/data-api/v3/exchange/market-pairs/latest?slug=crmclick&category=spot&start=1&limit=1")
    print("  spot pairs:", json.loads(t)["data"]["numMarketPairs"])
    for cat in ("perpetual", "futures"):
        s, h, t, secs = req(CMC, "GET", f"/data-api/v3/exchange/market-pairs/latest?slug=crmclick&category={cat}&start=1&limit=1")
        print(f"  {cat} pairs:", json.loads(t)["data"]["numMarketPairs"])
        time.sleep(PACE)


def main():
    host_and_latency()
    frows = catalog()
    anchor(frows)
    book_compare()
    spot_compare()
    errors()
    server_time()
    cmc()


if __name__ == "__main__":
    main()
