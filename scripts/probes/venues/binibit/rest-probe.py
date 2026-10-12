# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Binibit's futures preview data and its documented spot API, public calls only.

The futures terminal at binibit.com/en/futures/BTC_USDT reads every number through the site's own
Next.js route /api/futures-public/<name>, found in the page chunk of the web bundle.
The documented spot API lives on public-api.binibit.com and internal-api.binibit.com.

Modes, all by default, or name some on the command line:
    host     DNS, cold and warm request time for each host the site and the docs name
    catalog  /api/futures-public/contracts and /settings, counted by quote, leverage, fee and funding interval
    anchor   the per-symbol ticker fields, and what the contracts call carries for funding
    mirror   Binibit's futures book, funding and ticker beside Bybit's linear market, and the BTCUSDT top beside Binance and OKX
    book     /api/futures-public/orderbook for BTCUSDT at depths 1, 10, 50, 51, 200 and 1000, level order and crossed check
    poll     /api/futures-public/orderbook?symbol=BTCUSDT&depth=50 every 2 s for 30 s, then /contracts every 5 s for 60 s
    errors   unknown and malformed symbols, an unknown route, the private futures route without a login
    spot     the documented spot calls: healthcheck, pairs, commissions, orderbook, aggregator pairs and tickers
    time     the HTTP Date header against the local clock

Every call is unauthenticated.
The probe waits at least 1.0 s between calls to Binibit, inside the documented 10 per second and 60 per minute per IP.
The whole run makes about 75 requests to Binibit, 9 to Bybit, 1 to Binance and 1 to OKX.

Run from the repository root:
    uv run scripts/probes/venues/binibit/rest-probe.py [mode ...]
"""

import collections
import email.utils
import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

SITE = "https://binibit.com"
FP = SITE + "/api/futures-public"
PUBLIC = "https://public-api.binibit.com"
AGG = "https://internal-api.binibit.com/api/marketdata/getcoingecko"
STAGE = "https://internal-api-v2stage.binibit.com"  # the web bundle's API base, from main-app chunk
BYBIT = "https://api.bybit.com"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0", "Accept": "application/json"}
GAP_S = 1.0
WORK = Path(".claude/survey-work/binibit")
_last = [0.0]


def get(url: str, pace: bool = True) -> tuple[int, dict, bytes, float]:
    if pace:
        wait = _last[0] + GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, hdrs, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, dict(e.headers), e.read()
    except (urllib.error.URLError, ssl.SSLError, TimeoutError) as e:
        status, hdrs, body = 0, {}, repr(getattr(e, "reason", e)).encode()
    ms = (time.perf_counter() - t0) * 1000
    if pace:
        _last[0] = time.monotonic()
    return status, hdrs, body, ms


def js(body: bytes):
    try:
        return json.loads(body)
    except ValueError:
        return None


def hdr(h: dict, name: str) -> str | None:
    for k, v in h.items():
        if k.lower() == name.lower():
            return v
    return None


def save(name: str, body: bytes) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_bytes(body)


def host() -> None:
    print("== host")
    targets = [
        ("binibit.com", FP + "/settings"),
        ("public-api.binibit.com", PUBLIC + "/api/healthcheck"),
        ("internal-api.binibit.com", AGG + "/pairs"),
        ("internal-api-v2stage.binibit.com", STAGE + "/api/currency-pairs/commissions"),
        ("sockets-v2stage.binibit.com", "https://sockets-v2stage.binibit.com/"),
    ]
    for name, url in targets:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"DNS error {e}"]
        times = []
        for _ in range(3):
            s, h, b, ms = get(url)
            times.append(round(ms))
        print(f"{name}: addrs={addrs} status={s} cold_ms={times[0]} warm_ms={times[1:]} server={hdr(h, 'server')} via={hdr(h, 'x-vercel-id')}")


def catalog() -> None:
    print("== catalog")
    s, h, b, ms = get(FP + "/contracts")
    save("contracts.json", b)
    d = js(b)
    rows = d["data"]
    print(f"contracts status={s} bytes={len(b)} ms={ms:.0f} rows={len(rows)} meta={d.get('meta')} cache-control={hdr(h, 'cache-control')}")
    print("keys", sorted(rows[0].keys()))
    for field in ("quoteCurrency", "isActive", "contractValue", "makerFeeRate", "takerFeeRate", "maxLeverage"):
        print(field, dict(collections.Counter(str(r[field]) for r in rows)))
    iv = collections.Counter()
    for r in rows:
        start = time.strptime(r["fundingStartsAt"][:19], "%Y-%m-%dT%H:%M:%S")
        end = time.strptime(r["fundingFinishesAt"][:19], "%Y-%m-%dT%H:%M:%S")
        iv[(time.mktime(end) - time.mktime(start)) / 3600] += 1
    print("funding window hours", dict(iv))
    print("fundingFinishesAt", dict(collections.Counter(r["fundingFinishesAt"] for r in rows)))
    print("symbols", [r["symbol"] for r in rows])
    print("maxLeverage below 20:", [(r["symbol"], r["maxLeverage"]) for r in rows if r["maxLeverage"] != 20])
    print("non-8 h windows:", [(r["symbol"], r["fundingStartsAt"], r["fundingFinishesAt"]) for r in rows if not r["fundingFinishesAt"].endswith("08:00:00.000Z")])
    print("routeSlug equals base_quote on", sum(r["routeSlug"] == f"{r['baseCurrency']}_{r['quoteCurrency']}" for r in rows), "of", len(rows))
    s, h, b, ms = get(FP + "/settings")
    print(f"settings status={s} body={b.decode()[:300]}")


def anchor() -> None:
    print("== anchor")
    s, h, b, ms = get(FP + "/ticker?symbol=BTCUSDT")
    save("ticker-BTCUSDT.json", b)
    print(f"ticker status={s} bytes={len(b)} ms={ms:.0f} body={b.decode()[:400]}")
    d = js(b) or {}
    keys = sorted((d.get("data") or {}).keys())
    print("ticker keys", keys)
    print("mark, index or funding in ticker:", [k for k in keys if any(w in k.lower() for w in ("mark", "index", "fund"))])
    s, h, b, ms = get(FP + "/contracts")
    rows = js(b)["data"]
    print(f"contracts bytes={len(b)} ms={ms:.0f} funding fields:", [k for k in rows[0] if "fund" in k.lower()])
    print("mark or index anywhere in contracts:", any(w in b.decode().lower() for w in ("markprice", "indexprice", "\"mark", "\"index")))
    for name in ("mark-price", "index-price", "funding", "funding-rate", "premium-index"):
        s, h, b, ms = get(FP + f"/{name}?symbol=BTCUSDT")
        print(f"/{name} status={s} body={b.decode()[:160]}")


def bybit_top(sym: str) -> tuple:
    s, h, b, ms = get(f"{BYBIT}/v5/market/orderbook?category=linear&symbol={sym}&limit=5", pace=False)
    r = js(b)["result"]
    return r["b"][0], r["a"][0], r.get("ts")


def mirror() -> None:
    print("== mirror")
    for sym in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
        s, h, b, ms = get(FP + f"/orderbook?symbol={sym}&depth=10")
        t_bini = time.time()
        bb, ba, bts = bybit_top(sym)
        d = js(b)["data"]
        print(f"{sym} binibit bid={d['bids'][0]} ask={d['asks'][0]} fetchedAt={js(b)['meta']['fetchedAt']}")
        print(f"{sym} bybit   bid={bb} ask={ba} ts={bts} local={t_bini:.3f}")
    s, h, b, ms = get(FP + "/contracts")
    rows = js(b)["data"]
    s2, h2, b2, ms2 = get(f"{BYBIT}/v5/market/tickers?category=linear", pace=False)
    by = {x["symbol"]: x for x in js(b2)["result"]["list"]}
    same_rate = same_next = same_iv = 0
    for r in rows:
        x = by.get(r["symbol"])
        if not x:
            print("absent on Bybit", r["symbol"])
            continue
        same_rate += float(x["fundingRate"]) == float(r["fundingRate"])
        nxt = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(int(x["nextFundingTime"]) / 1000))
        same_next += nxt == r["fundingFinishesAt"]
        start = time.mktime(time.strptime(r["fundingStartsAt"][:19], "%Y-%m-%dT%H:%M:%S"))
        end = time.mktime(time.strptime(r["fundingFinishesAt"][:19], "%Y-%m-%dT%H:%M:%S"))
        same_iv += (end - start) / 3600 == float(x["fundingIntervalHour"])
        print(f"{r['symbol']} binibit rate={r['fundingRate']} next={r['fundingFinishesAt']} bybit rate={x['fundingRate']} next={nxt} interval_h={x['fundingIntervalHour']}")
    print(f"of {len(rows)}: rate equal {same_rate}, next settlement equal {same_next}, window equals Bybit interval {same_iv}")
    for sym in ("BTCUSDT", "ETHUSDT", "ONDOUSDT", "AAVEUSDT"):
        s3, h3, b3, ms3 = get(f"{BYBIT}/v5/market/funding/history?category=linear&symbol={sym}&limit=2", pace=False)
        hist = [(x["fundingRate"], time.strftime("%H:%M", time.gmtime(int(x["fundingRateTimestamp"]) / 1000))) for x in js(b3)["result"]["list"]]
        print(f"{sym} binibit rate={next(r['fundingRate'] for r in rows if r['symbol'] == sym)} bybit last settled={hist}")
    s, h, b, ms = get(FP + "/orderbook?symbol=BTCUSDT&depth=5")
    others = {
        "binance": ("https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=5", lambda d: (d["bids"][0][0], d["asks"][0][0])),
        "okx": ("https://www.okx.com/api/v5/market/books?instId=BTC-USDT-SWAP&sz=5", lambda d: (d["data"][0]["bids"][0][0], d["data"][0]["asks"][0][0])),
        "bybit": (f"{BYBIT}/v5/market/orderbook?category=linear&symbol=BTCUSDT&limit=5", lambda d: (d["result"]["b"][0][0], d["result"]["a"][0][0])),
    }
    d = js(b)["data"]
    print(f"BTCUSDT tops: binibit=({d['bids'][0]['price']}, {d['asks'][0]['price']})", end="")
    for name, (url, pick) in others.items():
        s4, h4, b4, ms4 = get(url, pace=False)
        try:
            print(f" {name}={pick(js(b4))}", end="")
        except (TypeError, KeyError, IndexError):
            print(f" {name}=status {s4}", end="")
    print()
    s, h, b, ms = get(FP + "/ticker?symbol=BTCUSDT")
    t = js(b)["data"]
    x = by["BTCUSDT"]
    print(f"ticker binibit last={t['last']} volume24h={t['volume24h']} high={t['high24h']} low={t['low24h']} price24hAgo={t['price24hAgo']}")
    print(f"ticker bybit   last={x['lastPrice']} turnover24h={x['turnover24h']} high={x['highPrice24h']} low={x['lowPrice24h']} prevPrice24h={x['prevPrice24h']}")


def book() -> None:
    print("== book")
    for depth in (1, 10, 50, 51, 200, 1000):
        s, h, b, ms = get(FP + f"/orderbook?symbol=BTCUSDT&depth={depth}")
        d = js(b) or {}
        data = d.get("data")
        if not isinstance(data, dict):
            print(f"depth={depth} status={s} body={b.decode()[:200]}")
            continue
        bids = [float(x["price"]) for x in data["bids"]]
        asks = [float(x["price"]) for x in data["asks"]]
        print(
            f"depth={depth} status={s} bytes={len(b)} ms={ms:.0f} bids={len(bids)} asks={len(asks)}"
            f" bids_desc={bids == sorted(bids, reverse=True)} asks_asc={asks == sorted(asks)}"
            f" crossed={bool(bids and asks and bids[0] >= asks[0])} cache={hdr(h, 'cache-control')} x-vercel-cache={hdr(h, 'x-vercel-cache')} keys={sorted(data.keys())}"
        )
        if depth == 50:
            save("orderbook-BTCUSDT-50.json", b)
    s, h, b, ms = get(FP + "/orderbook?symbol=BTCUSDT")
    d = js(b) or {}
    data = d.get("data") or {}
    print(f"no depth: status={s} bids={len(data.get('bids', []))} asks={len(data.get('asks', []))}")


def poll() -> None:
    print("== poll")
    tops, n = [], 0
    end = time.monotonic() + 30
    while time.monotonic() < end:
        s, h, b, ms = get(FP + "/orderbook?symbol=BTCUSDT&depth=50", pace=False)
        n += 1
        d = js(b)
        if s == 200 and d:
            tops.append((d["data"]["bids"][0]["price"], d["data"]["bids"][0]["quantity"], d["data"]["asks"][0]["price"], d["data"]["asks"][0]["quantity"], d["meta"]["fetchedAt"]))
        time.sleep(2)
    changes = sum(1 for a, b in zip(tops, tops[1:]) if a[:4] != b[:4])
    print(f"polls={n} ok={len(tops)} top_of_book_changes={changes} distinct_fetchedAt={len({t[4] for t in tops})}")
    for t in tops[:4]:
        print(" ", t)
    rates, fetched = [], set()
    end = time.monotonic() + 60
    while time.monotonic() < end:
        s, h, b, ms = get(FP + "/contracts", pace=False)
        d = js(b)
        if s == 200 and d:
            fetched.add(d["meta"]["fetchedAt"])
            row = {r["symbol"]: r for r in d["data"]}
            rates.append((row["BTCUSDT"]["fundingRate"], row["ETHUSDT"]["fundingRate"], row["ONDOUSDT"]["fundingFinishesAt"]))
        time.sleep(5)
    print(f"contracts polls={len(rates)} over 60 s, distinct fetchedAt={len(fetched)}, BTCUSDT rate changes={sum(1 for a, b in zip(rates, rates[1:]) if a[0] != b[0])}, ETHUSDT rate changes={sum(1 for a, b in zip(rates, rates[1:]) if a[1] != b[1])}")
    print("  first and last (BTC rate, ETH rate, ONDO next):", rates[:1], rates[-1:])


def errors() -> None:
    print("== errors")
    cases = [
        ("unknown symbol", FP + "/orderbook?symbol=FOOUSDT&depth=50"),
        ("slug form", FP + "/orderbook?symbol=BTC_USDT&depth=50"),
        ("lower case", FP + "/orderbook?symbol=btcusdt&depth=50"),
        ("missing symbol", FP + "/orderbook"),
        ("unknown route", FP + "/nosuchroute"),
        ("ticker unknown", FP + "/ticker?symbol=FOOUSDT"),
        ("private futures", SITE + "/api/futures-private"),
        ("private trading", SITE + "/api/futures-private/trading"),
    ]
    for label, url in cases:
        s, h, b, ms = get(url)
        print(f"{label}: status={s} cache={hdr(h, 'cache-control')} body={b.decode(errors='replace')[:220]}")


def spot() -> None:
    print("== spot")
    cases = [
        ("healthcheck", PUBLIC + "/api/healthcheck"),
        ("pairs", PUBLIC + "/api/currencies/pairs"),
        ("commissions", PUBLIC + "/api/currencies/commissions"),
        ("orderbook BTC_USDT", PUBLIC + "/api/orderbook?currencyPairCode=BTC_USDT"),
        ("aggregator pairs", AGG + "/pairs"),
        ("aggregator tickers", AGG + "/tickers"),
        ("stage commissions", STAGE + "/api/currency-pairs/commissions"),
    ]
    for label, url in cases:
        s, h, b, ms = get(url)
        d = js(b)
        size = len(d) if isinstance(d, list) else (len(d.get("data", {}).get("market_pairs", [])) if isinstance(d, dict) and "data" in d else None)
        rl = {k: v for k, v in h.items() if k.lower().startswith("x-ratelimit") or k.lower() == "retry-after"}
        print(f"{label}: status={s} bytes={len(b)} ms={ms:.0f} rows={size} ratelimit={rl} head={b[:160]!r}")
        if label == "stage commissions" and isinstance(d, dict):
            c = d.get("commissions", [])
            trade = collections.Counter(x["percent"] for x in c if x.get("currencyPairCode"))
            print(f"  stage commissions rows={len(c)} pair-level percent counts={dict(trade)} type codes={dict(collections.Counter(x['commissionTypeCode'] for x in c))}")
        if label == "aggregator tickers" and isinstance(d, list):
            btc = [x for x in d if x.get("ticker_id") == "BTC_USDT"]
            print(f"  BTC_USDT aggregator ticker {btc[:1]}")
        if label == "orderbook BTC_USDT" and isinstance(d, list):
            bids = [x["price"] for x in d if x["isBid"]]
            asks = [x["price"] for x in d if not x["isBid"]]
            print(f"  spot BTC_USDT best bid={max(bids) if bids else None} best ask={min(asks) if asks else None} levels={len(bids)}/{len(asks)}")


def clock() -> None:
    print("== time")
    for url in (FP + "/orderbook?symbol=BTCUSDT&depth=1", FP + "/settings", PUBLIC + "/api/healthcheck"):
        t0 = time.time()
        s, h, b, ms = get(url)
        t1 = time.time()
        date = hdr(h, "date")
        if date:
            server = email.utils.parsedate_to_datetime(date).timestamp()
            print(f"{url}: Date={date} offset_s={server - (t0 + t1) / 2:+.2f} (1 s resolution) x-vercel-cache={hdr(h, 'x-vercel-cache')} age={hdr(h, 'age')}")
        d = js(b)
        if isinstance(d, dict) and "meta" in d:
            print(f"  meta.fetchedAt={d['meta'].get('fetchedAt')} local={time.strftime('%Y-%m-%dT%H:%M:%S', time.gmtime((t0 + t1) / 2))}")


MODES = {"host": host, "catalog": catalog, "anchor": anchor, "mirror": mirror, "book": book, "poll": poll, "errors": errors, "spot": spot, "time": clock}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    print("run at", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for m in picked:
        MODES[m]()
