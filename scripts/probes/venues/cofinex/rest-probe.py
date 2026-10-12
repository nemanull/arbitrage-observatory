# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Cofinex REST probe for docs/profiles/cofinex/rest.md.

Public, unauthenticated and read-only, about 110 requests over about 2 minutes.
  1. DNS for every Cofinex host named in the API docs or the web bundle.
  2. The documented API at dataapi.cofinex.io, read from apidocs.cofinex.io/openapi.json.
  3. The spot endpoints the cofinex.io web app calls on marketdata.cofinex.io, cold and warm.
  4. Guessed futures paths on marketdata.cofinex.io and the futures page URLs on cofinex.io.
  5. REST book freshness: twelve polls 5 s apart of both symbol spellings, against Bitget's own BTCUSDT book.
  6. Error shapes, rate limit headers and the Date header offset.
  7. CoinMarketCap's view of Cofinex perpetuals.
Run from the repository root with: uv run scripts/probes/venues/cofinex/rest-probe.py
"""

import collections
import email.utils
import json
import socket
import time
import urllib.error
import urllib.request

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html"}
MD = "https://marketdata.cofinex.io"
DATA = "https://dataapi.cofinex.io"


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


def head(body, n=160):
    return body[:n].decode("utf-8", "replace").replace("\n", " ")


def section_dns():
    print("== 1. DNS")
    for h in ("cofinex.io", "www.cofinex.io", "cofinex.com", "apidocs.cofinex.io", "dataapi.cofinex.io", "dataapi.cofinex.in",
              "marketdata.cofinex.io", "wss1.cofinex.io", "tradeapi1.cofinex.io", "auth.cofinex.io", "api.cofinex.io"):
        try:
            canon, _, addrs = socket.gethostbyname_ex(h)
            print(f"{h}: {sorted(addrs)} canonical {canon}")
        except OSError as e:
            print(f"{h}: {e}")


def section_documented():
    print("== 2. Documented API")
    s, _, body, ms = get("https://apidocs.cofinex.io/openapi.json")
    spec = json.loads(body)
    print(f"openapi.json {s} {len(body)} bytes, version {spec.get('openapi')}, servers {[x['url'] for x in spec.get('servers', [])]}")
    public = [(m.upper(), p) for p, v in spec["paths"].items() for m, o in v.items() if "Public API" in o.get("tags", [])]
    print(f"public paths {len(public)}: {public}")
    enum = spec["paths"]["/marketdata/tradepairinfo/{tradeType}"]["get"]["parameters"][0]["schema"]["enum"]
    print(f"tradeType enum {enum}")
    ex = spec["paths"]["/marketdata/tradepairinfo/{tradeType}"]["get"]["responses"]["200"]["content"]["application/json"]["examples"]["future"]["value"]["body"][0]
    print(f"FUTURE example row {ex}")
    for p in ("/marketdata/tickerinfo", "/marketdata/tradepairinfo/SPOT", "/marketdata/tradepairinfo/FUTURE",
              "/marketdata/orderbook/FUTURE/BTCUSDT", "/marketdata/orderbook/SPOT/BTCUSDT", "/marketdata/assetinfo"):
        for host in (DATA, "https://dataapi.cofinex.in"):
            s, h, body, ms = get(host + p)
            print(f"{host}{p}: {s} {len(body)} bytes {ms:.0f} ms server {h.get('Server') or h.get('server')} body {head(body, 90)!r}")


def section_web_spot():
    print("== 3. Web app spot endpoints on marketdata.cofinex.io")
    paths = ("spot/v1/tradepair", "spot/v1/summary", "spot/v1/market/BTC_USDT", "spot/v1/orderbook/BTC_USDT?depth=20&level=3",
             "spot/v1/trades/BTC_USDT?limit=40", "spot/v1/quote-currencies")
    bodies = {}
    for p in paths:
        times = []
        for _ in range(2):
            s, h, body, ms = get(f"{MD}/{p}")
            times.append(ms)
        bodies[p] = body
        print(f"{p}: {s} {len(body)} bytes, cold {times[0]:.0f} ms warm {times[1]:.0f} ms, server {h.get('server')}, cache {h.get('cache-control')}")
    tp = json.loads(bodies["spot/v1/tradepair"])["data"]
    pairs = tp["pairs"]
    print(f"tradepair total {tp['total']} rows {len(pairs)}")
    print("by exchange", dict(collections.Counter(p["exchange"] for p in pairs)))
    print("by exchange and status", dict(collections.Counter(f"{p['exchange']} {p['data'].get('status')}" for p in pairs)))
    print("by quote", dict(collections.Counter(p["data"].get("quoteCoin") for p in pairs)))
    print("by source", dict(collections.Counter(p["data"].get("source") for p in pairs)))
    print("symbols listed twice", [k for k, v in collections.Counter(p["symbol"] for p in pairs).items() if v > 1])
    print("cofinex rows", [p["symbol"] for p in pairs if p["exchange"] == "cofinex"])
    btc = next(p for p in pairs if p["symbol"] == "BTCUSDT")
    print("BTCUSDT row", json.dumps(btc))
    summ = json.loads(bodies["spot/v1/summary"])["data"]
    print(f"summary rows {len(summ)}, keys {sorted(summ[0].keys())}")
    print("market BTC_USDT", head(bodies["spot/v1/market/BTC_USDT"], 400))
    print("trades first", json.dumps(json.loads(bodies["spot/v1/trades/BTC_USDT?limit=40"])["data"][0]),
          "count", len(json.loads(bodies["spot/v1/trades/BTC_USDT?limit=40"])["data"]))
    for spelling in ("BTC_USDT", "BTCUSDT"):
        for q in ("depth=5&level=3", "depth=10&level=3", "depth=20&level=3", "depth=50&level=3", "depth=200&level=3", "depth=500&level=3", "depth=20&level=0", ""):
            s, _, body, _ = get(f"{MD}/spot/v1/orderbook/{spelling}?{q}")
            d = json.loads(body).get("data") or {}
            b, a = d.get("bids", []), d.get("asks", [])
            order = all(float(b[i][0]) > float(b[i + 1][0]) for i in range(len(b) - 1)) and all(float(a[i][0]) < float(a[i + 1][0]) for i in range(len(a) - 1))
            print(f"orderbook {spelling} ?{q}: {s} bids {len(b)} asks {len(a)}, bids descending and asks ascending {order}")


def section_futures_paths():
    print("== 4. Futures surfaces")
    for p in ("future/v1/tradepair", "futures/v1/tradepair", "future/v1/summary", "futures/v1/summary", "contract/v1/summary",
              "perpetual/v1/summary", "marketdata/tradepairinfo/FUTURE"):
        s, _, body, _ = get(f"{MD}/{p}")
        print(f"marketdata {p}: {s} {head(body, 70)!r}")
    s, _, body, _ = get(f"{MD}/spot/v1/tradepair?productType=FUTURE")
    print(f"marketdata spot/v1/tradepair?productType=FUTURE: {s}, total {json.loads(body)['data']['total']}, same as spot")
    for p in ("trade/UMCBL/ETH-USDT", "en/futures", "en/market/futures/BTC-USDT", "fee-details-trade", "en/market/spot/BTC-USDT"):
        s, _, body, _ = get(f"https://cofinex.io/{p}")
        nf = b"NEXT_HTTP_ERROR_FALLBACK;404" in body
        print(f"cofinex.io/{p}: {s} {len(body)} bytes, renders the not found page {nf}")


def bitget_top():
    s, _, body, _ = get("https://api.bitget.com/api/v2/spot/market/orderbook?symbol=BTCUSDT&type=step0&limit=15")
    d = json.loads(body)["data"]
    return float(d["bids"][0][0]), float(d["asks"][0][0]), int(d["ts"])


def section_freshness():
    print("== 5. REST book freshness")
    seen = {"BTC_USDT": set(), "BTCUSDT": set()}
    for i in range(12):
        line = [f"poll {i}:"]
        for spelling in seen:
            s, _, body, _ = get(f"{MD}/spot/v1/orderbook/{spelling}?depth=20&level=3")
            now = time.time() * 1000
            d = json.loads(body)["data"]
            seen[spelling].add(d["timestamp"])
            line.append(f"{spelling} ts age {(now - int(d['timestamp'])) / 1000:.0f} s top {d['bids'][0][0]} / {d['asks'][0][0]},")
        _, _, mbody, _ = get(f"{MD}/spot/v1/market/BTC_USDT")
        m = json.loads(mbody)["data"]
        bb, ba, bts = bitget_top()
        line.append(f"market updated_at age {time.time() - m['updated_at']:.0f} s bid {m['highest_bid']} ask {m['lowest_ask']}, Bitget top {bb} / {ba}")
        print(" ".join(line))
        time.sleep(5)
    print("distinct book timestamps over 60 s", {k: len(v) for k, v in seen.items()})


def section_errors():
    print("== 6. Errors, limits and clock")
    for p in ("spot/v1/orderbook/NOTACOIN_USDT", "spot/v1/market/NOTACOIN_USDT", "spot/v1/trades/NOTACOIN_USDT", "spot/v1/orderbook/BTCUSDT", "nope"):
        s, h, body, _ = get(f"{MD}/{p}")
        print(f"{p}: {s} {head(body, 160)!r}")
    s, h, body, _ = get(f"{MD}/spot/v1/market/BTC_USDT")
    lim = {k: v for k, v in h.items() if "limit" in k.lower() or "retry" in k.lower()}
    print(f"rate limit headers {lim or 'none'}, all headers {sorted(h)}")
    offsets = []
    for _ in range(3):
        t0 = time.time()
        s, h, body, _ = get(f"{MD}/spot/v1/market/BTC_USDT")
        t1 = time.time()
        server = email.utils.parsedate_to_datetime(h.get("Date") or h["date"]).timestamp()
        offsets.append(server - (t0 + t1) / 2)
    print(f"Date header minus local midpoint s {[round(x, 2) for x in offsets]} (whole second resolution)")
    burst = collections.Counter()
    t0 = time.perf_counter()
    for _ in range(10):
        s, _, _, _ = get(f"{MD}/spot/v1/market/BTC_USDT")
        burst[s] += 1
    print(f"10 sequential requests in {time.perf_counter() - t0:.1f} s: {dict(burst)}")


def section_cmc():
    print("== 7. CoinMarketCap")
    s, _, body, _ = get("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=cofinex")
    d = json.loads(body)["data"]
    print(f"detail {s}: id {d['id']} launched {d.get('dateLaunched')} countries {d.get('countries')} fee url {d['urls'].get('fee')} makerFee {d.get('makerFee')} takerFee {d.get('takerFee')}")
    s, _, body, _ = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=cofinex&category=perpetual&start=1&limit=200")
    d = json.loads(body)["data"]
    mp = d["marketPairs"]
    print(f"perpetual pairs {d.get('numMarketPairs')}, first page {len(mp)}, quotes on first page {dict(collections.Counter(m['quoteSymbol'] for m in mp))}")
    print("excluded flags on first page", dict(collections.Counter((m.get("priceExcluded"), m.get("volumeExcluded")) for m in mp)))
    for m in mp[:3]:
        print(f"  {m['marketPair']} ticker {m.get('derivativeTickerId')} url {m['marketUrl']} vol {m['volumeUsd']:.0f} oi {m.get('openInterestUsd')} index {m.get('indexPrice')} funding {m.get('fundingRate')} updated {m.get('lastUpdated')}")
    s, _, body, _ = get("https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=cofinex&category=spot&start=1&limit=1")
    print(f"spot pairs {json.loads(body)['data'].get('numMarketPairs')}")


if __name__ == "__main__":
    for f in (section_dns, section_documented, section_web_spot, section_futures_paths, section_freshness, section_errors, section_cmc):
        try:
            f()
        except Exception as e:  # record and continue, each section is independent
            print(f"{f.__name__} failed: {type(e).__name__}: {e}")
