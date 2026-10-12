# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""CEEX REST probe for docs/profiles/ceex/rest.md.

Public, unauthenticated and read-only, about 40 requests over about 40 seconds.
  1. DNS for the site, its mirrors and the API names.
  2. Latency: /openapi/v1/time cold and warm, and the Date header offset.
  3. The live perpetual catalog /api/v3/triggerContract/system/getContractConfigAllList, and the contractSymbols list in the site config.
  4. The legacy BHEX swap catalog in /openapi/v1/brokerInfo, with its book, trades, ticker and funding replies.
  5. Anchor candidates: the contract index call, the funding calls, and the price calls the site makes behind login.
  6. REST books: the OpenAPI depth for BTCUSDT, and whether it is the spot or the perpetual book.
  7. Spot catalog count, rate limit headers and error shapes.
Run from the repository root with: uv run scripts/probes/venues/ceex/rest-probe.py
"""

import collections
import email.utils
import json
import socket
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, */*"}
SITE = "https://www.ceex.com"


def get(path, timeout=30):
    url = path if path.startswith("http") else SITE + path
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), r.read(), (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read(), (time.perf_counter() - t0) * 1000
    except Exception as e:  # DNS failure, TLS error, timeout
        return None, {}, f"{type(e).__name__}: {e}".encode(), (time.perf_counter() - t0) * 1000


def utc(ms):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(int(ms) / 1000))


def show(path, n=300):
    st, h, body, ms = get(path)
    print(f"GET {path}: {st}, {len(body)} bytes, {ms:.0f} ms: {body[:n].decode('utf-8', 'replace')}")
    return st, h, body


def section_dns():
    print("== 1. DNS")
    for host in ("ceex.com", "www.ceex.com", "api.ceex.com", "wsapi.ceex.com", "openapi.ceex.com", "www.ceexcloud.com", "www.ceexs.com", "static.ceex.com"):
        try:
            print(f"{host}: {sorted(set(a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)))}")
        except OSError as e:
            print(f"{host}: {e}")
    for host in ("https://ceex.com/", "https://www.ceex.com/", "https://api.ceex.com/openapi/v1/time", "https://wsapi.ceex.com/"):
        st, h, body, ms = get(host)
        print(f"GET {host}: {st}, {len(body)} bytes, server {h.get('Server')!r}, location {h.get('Location')!r}")


def section_latency():
    print("== 2. Latency and clock")
    for i in range(4):
        before = time.time()
        st, h, body, ms = get("/openapi/v1/time")
        after = time.time()
        server = json.loads(body)["serverTime"]
        mid = (before + after) / 2 * 1000
        print(f"try {i + 1}: {st} in {ms:.0f} ms, serverTime {server} ({utc(server)} UTC), offset to host midpoint {server - mid:+.0f} ms, Date {h.get('Date')}")
    d = email.utils.parsedate_to_datetime(h["Date"]).timestamp()
    print(f"Date header offset {d - time.time():+.1f} s")
    st, h, body, ms = get("/openapi/v1/ping")
    print(f"/openapi/v1/ping: {st} {body!r} in {ms:.0f} ms")


def section_catalog():
    print("== 3. Live perpetual catalog")
    for i in range(2):
        st, h, body, ms = get("/api/v3/triggerContract/system/getContractConfigAllList")
        print(f"getContractConfigAllList try {i + 1}: {st}, {len(body)} bytes, {ms:.0f} ms")
    j = json.loads(body)
    rows = j["data"]
    print(f"code {j['code']!r} msg {j['msg']!r}, rows {len(rows)}")
    print(f"keys {sorted(rows[0].keys())}")
    print(f"enabledState {collections.Counter(r['enabledState'] for r in rows)}, tradingState {collections.Counter(r['tradingState'] for r in rows)}")
    print(f"fundingFeeRate values {collections.Counter(r['fundingFeeRate'] for r in rows)}, fundingInterval values {collections.Counter(r['fundingInterval'] for r in rows)}")
    for r in rows:
        tiers = r["positionTiersConfigList"]
        print(f"  {r['symbol']}: id {r['id']}, token {r['token']}, maxLeverage {r['maxLeverage']}, minOrderQuantity {r['minOrderQuantity']}, minStepQuantity {r['minStepQuantity']}, "
              f"pricePrecision {r['pricePrecision']}, quantityPrecision {r['quantityPrecision']}, tiers {len(tiers)}, tier 1 mmr {tiers[0]['maintenanceMarginRate']} up to {tiers[0]['maxPositionQuantity']}")
    fee_keys = [k for k in rows[0] if "fee" in k.lower() or "taker" in k.lower() or "maker" in k.lower()]
    print(f"fee-like keys in a catalog row: {fee_keys}")
    st, h, body, ms = get("/s_api/basic/config_v2_js?custom_keys=loginReg,analytics&callback=window.__set_config&tab=exchange&type=all&platform=1&without_country=true")
    s = body.decode()
    cfg = json.loads(s[s.index("(") + 1:s.rindex(")")])
    print(f"site config: {st}, {len(body)} bytes, functions {cfg['functions']}")
    print(f"site config contractSymbols {[c['symbol'] for c in cfg['contractSymbols']]}")
    print(f"site config futuresSymbol {[c['symbolId'] for c in cfg['futuresSymbol']]}, symbol (spot) {len(cfg['symbol'])}, optionSymbol {len(cfg['optionSymbol'])}, marginSymbol {len(cfg['marginSymbol'])}")
    show("/api/v3/triggerContract/system/getContractConfigBySymbol?symbol=BTCUSDT", 160)
    show("/api/v3/triggerContract/system/getContractConfigBySymbol?symbol=NOPEUSDT", 200)
    return rows


def section_legacy():
    print("== 4. Legacy BHEX swaps")
    st, h, body, ms = get("/openapi/v1/brokerInfo")
    j = json.loads(body)
    print(f"brokerInfo: {st}, {len(body)} bytes, {ms:.0f} ms, keys {sorted(j.keys())}, rateLimits {j['rateLimits']}")
    print(f"symbols {len(j['symbols'])} status {collections.Counter(s['status'] for s in j['symbols'])}, options {len(j['options'])}, contracts {len(j['contracts'])}")
    for c in j["contracts"]:
        print(f"  {c['symbol']}: status {c['status']}, index {c['index']}, contractMultiplier {c['contractMultiplier']}, inverse {c['inverse']}, marginToken {c['marginToken']}")
    for c in ("BTC-SWAP-USDT", "ETH-SWAP-USDT"):
        st, h, body, ms = get(f"/openapi/quote/v1/contract/depth?symbol={c}")
        d = json.loads(body)
        print(f"contract depth {c}: bids {len(d['bids'])} asks {len(d['asks'])}, best bid {d['bids'][0] if d['bids'] else None}, best ask {d['asks'][-1] if d['asks'] else None}")
        st, h, body, ms = get(f"/openapi/quote/v1/contract/trades?symbol={c}&limit=100")
        t = json.loads(body)
        print(f"contract trades {c}: {len(t)} rows, newest {utc(max(x['time'] for x in t)) if t else None} UTC")
        show(f"/openapi/quote/v1/contract/ticker/24hr?symbol={c}", 260)
    show("/openapi/contract/v1/fundingRate", 300)
    st, h, body, ms = get("/api/contract/funding_rates")
    fr = json.loads(body)
    print(f"/api/contract/funding_rates: {st}, {len(fr)} rows")
    for r in fr:
        print(f"  {r['tokenId']}: fundingRate {r['fundingRate']}, settleRate {r['settleRate']}, lastSettleTime {r['lastSettleTime']}, nextSettleTime {utc(r['nextSettleTime']) if r['nextSettleTime'] != '0' else 0}")


def section_anchor(rows):
    print("== 5. Anchor candidates")
    st, h, body, ms = get("/openapi/quote/v1/contract/index")
    idx = json.loads(body)
    print(f"contract index, all: {st}, {len(body)} bytes, {ms:.0f} ms, {len(idx['index'])} index keys, {len(idx.get('edp', {}))} edp keys")
    for r in rows:
        print(f"  {r['symbol']}: index {idx['index'].get(r['symbol'])}, edp {idx.get('edp', {}).get(r['symbol'])}")
    show("/openapi/quote/v1/contract/index?symbol=BTCUSDT", 200)
    for p in ("/api/v3/triggerContract/pageCalculate/getPriceAndFundingRate?symbol=BTCUSDT",
              "/api/v3/triggerContract/pageCalculate/getCurrentPrice?symbol=BTCUSDT",
              "/api/contract/history_funding_rates?tokenId=BTCUSDT",
              "/openapi/quote/v1/markPrice?symbol=BTCUSDT"):
        show(p, 200)


def section_books():
    print("== 6. REST books")
    st, h, body, ms = get("/openapi/quote/v1/depth?symbol=BTCUSDT&limit=100")
    d = json.loads(body)
    bp = [float(x[0]) for x in d["bids"]]
    ap = [float(x[0]) for x in d["asks"]]
    print(f"openapi depth BTCUSDT: {st}, {len(body)} bytes, {ms:.0f} ms, bids {len(bp)} asks {len(ap)}, bids descending {bp == sorted(bp, reverse=True)}, asks ascending {ap == sorted(ap)}, best bid {bp[0]} best ask {ap[0]}")
    show("/openapi/quote/v1/ticker/bookTicker?symbol=BTCUSDT", 200)
    show("/api/quote/v1/depth?symbol=301.BTCUSDT", 160)
    print(f"cache headers on depth: Cache-Control {h.get('Cache-Control')!r}, Age {h.get('Age')!r}")


def section_errors():
    print("== 7. Spot count, limits and errors")
    st, h, body, ms = get("/openapi/quote/v1/ticker/price")
    print(f"ticker/price: {st}, {len(json.loads(body))} rows")
    limit_headers = {k: v for k, v in h.items() if k.lower().startswith(("x-", "retry", "ratelimit"))}
    print(f"rate limit or x- headers on a reply: {limit_headers}, all header names {sorted(h)}")
    for p in ("/openapi/quote/v1/depth?symbol=NOPEUSDT", "/openapi/quote/v1/depth", "/openapi/quote/v1/contract/depth?symbol=NOPE-SWAP-USDT", "/api/v3/triggerContract/system/nope", "/openapi/v1/nope"):
        show(p, 200)


def main():
    print(f"host UTC {time.strftime('%Y-%m-%d %H:%M:%S', time.gmtime())}")
    section_dns()
    section_latency()
    rows = section_catalog()
    section_legacy()
    section_anchor(rows)
    section_books()
    section_errors()


main()
