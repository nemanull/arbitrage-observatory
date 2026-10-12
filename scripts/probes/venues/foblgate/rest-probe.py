# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe of FOBLGATE's public market data on api2.foblgate.com.

FOBLGATE publishes no API documentation.
The calls below are the ones its web app at www.foblgate.com makes without a login, read from the app's JS bundle.

Modes, all by default, or name some on the command line:
    host     DNS, cold and warm request time, the site, the API roots and the documentation host
    catalog  POST /ticker/marketList, counted by quote and by status flags, against CoinMarketCap's pair lists
    book     POST /ticker/orderBook for BTC/USDT and the busiest pair, level order, depth, crossed check
    mirror   FOBLGATE's BTC/USDT and ETH/USDT top of book beside Binance's, taken together
    poll     POST /ticker/orderBook for BTC/USDT and ZEUS/USDT every 5 s for 60 s, counting changes
    errors   unknown pair, missing pair, a GET, the key-gated /api/ paths without a key
    trades   POST /ticker/publicSign, the recent trades list, with its oldest and newest timestamps
    time     the HTTP Date header against the local clock

Every call is unauthenticated and read-only.
FOBLGATE publishes no rate limit, so the probe waits at least 1 s between its calls, about 40 calls in all.

Run from the repository root:
    uv run scripts/probes/venues/foblgate/rest-probe.py [mode ...]
"""

import collections
import email.utils
import hashlib
import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

API = "https://api2.foblgate.com"
FRONT = "https://api.foblgate.com"
SITE = "https://www.foblgate.com"
DOCS = "https://api-document.foblgate.com/"
BINANCE = "https://api.binance.com/api/v3/ticker/bookTicker?symbol={}"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=foblgate&category={}&start=1&limit=500"
UA = "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe/1.0"
GAP_S = 1.0
WORK = Path(".claude/survey-work/foblgate")
_last = [0.0]


def call(method: str, url: str, form: dict | None = None, json_body: dict | None = None, pace: bool = True):
    if pace:
        wait = _last[0] + GAP_S - time.monotonic()
        if wait > 0:
            time.sleep(wait)
    headers = {"User-Agent": UA, "Accept": "application/json"}
    data = None
    if form is not None:  # multipart, the way the web app's FormData posts it
        boundary = uuid.uuid4().hex
        parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in form.items()]
        data = ("".join(parts) + f"--{boundary}--\r\n").encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
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


def book(pair: str):
    return call("POST", f"{API}/ticker/orderBook", form={"pairName": pair})


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False))


def mode_host() -> None:
    for h in ("www.foblgate.com", "api2.foblgate.com", "api.foblgate.com", "api-document.foblgate.com"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"error {e}"]
        out(mode="host", host=h, addrs=addrs)
    for a in ("43.201.239.67", "54.117.20.212"):
        s, _, b, _ = call("GET", f"https://ipinfo.io/{a}/json", pace=False)
        info = json.loads(b) if s == 200 else {}
        out(mode="host", addr=a, org=info.get("org"), city=info.get("city"), country=info.get("country"))
    for url in (SITE + "/", API + "/", FRONT + "/", DOCS):
        s, hd, b, ms = call("GET", url)
        out(mode="host", url=url, status=s, ms=round(ms), server=hd.get("Server") or hd.get("server"), bytes=len(b), body=b[:160].decode(errors="replace"))
    times = []
    for _ in range(3):
        s, _, b, ms = book("BTC/USDT")
        times.append(round(ms))
    out(mode="host", call="POST /ticker/orderBook BTC/USDT", status=s, ms_cold_then_warm=times)


def mode_catalog() -> None:
    s, _, b, ms = call("POST", f"{API}/ticker/marketList", json_body={})
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / "marketList.json").write_bytes(b)
    d = json.loads(b)
    rows = d["data"]
    out(mode="catalog", status=s, top_status=d.get("status"), bytes=len(b), ms=round(ms), rows=len(rows), shape=type(rows).__name__)
    out(mode="catalog", fields=sorted(next(iter(rows.values())).keys()))
    out(mode="catalog", by_quote=collections.Counter(k.split("/")[1] for k in rows))
    flags = collections.Counter(f"tradeUse={v['tradeUse']} listUse={v['listUse']} askUse={v['askUse']} bidUse={v['bidUse']}" for v in rows.values())
    out(mode="catalog", flags=flags)
    out(mode="catalog", not_fully_on=[k for k, v in rows.items() if (v["tradeUse"], v["listUse"], v["askUse"], v["bidUse"]) != ("ON",) * 4])
    out(mode="catalog", key_equals_marketName=all(k == v["marketName"] for k, v in rows.items()), delisting_dates=[k for k, v in rows.items() if v["delistingDt"]])
    traded = sorted(((k, float(v["tradingValue24"])) for k, v in rows.items() if float(v["tradingValue24"]) > 0), key=lambda x: -x[1])
    out(mode="catalog", pairs_with_24h_value=len(traded), top=traded[:10])
    out(mode="catalog", majors=[k for k in rows if k.split("/")[0] in ("BTC", "ETH", "USDT", "XRP", "SOL")])
    for cat in ("spot", "perpetual", "futures"):
        req = urllib.request.Request(CMC.format(cat), headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            c = json.loads(r.read())
        pairs = (c.get("data") or {}).get("marketPairs", [])
        out(mode="catalog", cmc=cat, num=(c.get("data") or {}).get("numMarketPairs"), by_quote=collections.Counter(p["quoteSymbol"] for p in pairs),
            excluded=collections.Counter(f"price={p.get('priceExcluded')} volume={p.get('volumeExcluded')}" for p in pairs))


def summarize_book(pair: str, keep: bool = False) -> dict:
    s, hd, b, ms = book(pair)
    d = json.loads(b)
    x = d.get("data") or {}
    bids = [(float(r["price"]), float(r["amount"])) for r in x.get("buyList", [])]
    asks = [(float(r["price"]), float(r["amount"])) for r in x.get("sellList", [])]
    if keep:
        WORK.mkdir(parents=True, exist_ok=True)
        (WORK / f"book-{pair.replace('/', '-')}.json").write_bytes(b)
    return {
        "pair": pair, "status": s, "top_status": d.get("status"), "message": d.get("message"), "bytes": len(b), "ms": round(ms),
        "keys": sorted(x.keys()), "bids": len(bids), "asks": len(asks),
        "bids_desc": all(bids[i][0] > bids[i + 1][0] for i in range(len(bids) - 1)),
        "asks_asc": all(asks[i][0] < asks[i + 1][0] for i in range(len(asks) - 1)),
        "best_bid": bids[0] if bids else None, "best_ask": asks[0] if asks else None,
        "crossed": bool(bids and asks and bids[0][0] >= asks[0][0]),
        "tickUnit": x.get("tickUnit"), "amountUnit": x.get("amountUnit"), "volumePower": x.get("volumePower"),
        "cache_control": hd.get("Cache-Control") or hd.get("cache-control"),
        "sha": hashlib.sha256(json.dumps(x, sort_keys=True).encode()).hexdigest()[:12],
    }


def mode_book() -> None:
    for pair in ("BTC/USDT", "ZEUS/USDT", "ETH/USDT"):
        out(mode="book", **summarize_book(pair, keep=True))
    s, _, b, _ = book("BTC/USDT")
    out(mode="book", raw_first_levels=json.loads(b)["data"]["buyList"][:2])


def mode_mirror() -> None:
    for pair in ("BTC/USDT", "ETH/USDT"):
        f = summarize_book(pair)
        s, _, b, _ = call("GET", BINANCE.format(pair.replace("/", "")), pace=False)
        bn = json.loads(b)
        mid_f = (f["best_bid"][0] + f["best_ask"][0]) / 2
        mid_b = (float(bn["bidPrice"]) + float(bn["askPrice"])) / 2
        out(mode="mirror", pair=pair, fobl_bid=f["best_bid"], fobl_ask=f["best_ask"], binance_bid=bn["bidPrice"], binance_ask=bn["askPrice"],
            fobl_spread_bps=round((f["best_ask"][0] - f["best_bid"][0]) / mid_f * 1e4, 1), mid_diff_bps=round((mid_f - mid_b) / mid_b * 1e4, 1))


def mode_poll() -> None:
    seen = collections.defaultdict(list)
    t0 = time.monotonic()
    while time.monotonic() - t0 < 60:
        for pair in ("BTC/USDT", "ZEUS/USDT"):
            seen[pair].append(summarize_book(pair)["sha"])
        time.sleep(max(0.0, 5 - GAP_S * 2))
    for pair, shas in seen.items():
        changes = sum(1 for i in range(1, len(shas)) if shas[i] != shas[i - 1])
        out(mode="poll", pair=pair, polls=len(shas), distinct_books=len(set(shas)), changes=changes)


def mode_errors() -> None:
    cases = [
        ("unknown pair", "POST", f"{API}/ticker/orderBook", {"pairName": "FOO/USDT"}),
        ("closed pair", "POST", f"{API}/ticker/orderBook", {"pairName": "BTC/KRW"}),
        ("missing pair", "POST", f"{API}/ticker/orderBook", {}),
        ("open api book without key", "POST", f"{API}/api/ticker/orderBook", {"pairName": "BTC/USDT"}),
        ("open api book with a fake key", "POST", f"{API}/api/ticker/orderBook", {"pairName": "BTC/USDT", "apiKey": "x"}),
        ("open api chart with a fake key", "POST", f"{API}/api/chart/selectChart", {"pairName": "BTC/USDT", "apiKey": "x"}),
        ("publicSign", "POST", f"{API}/ticker/publicSign", {"pairName": "BTC/USDT"}),
    ]
    for name, method, url, form in cases:
        s, _, b, _ = call(method, url, form=form)
        out(mode="errors", case=name, status=s, body=b[:200].decode(errors="replace"))
    s, _, b, _ = call("GET", f"{API}/ticker/orderBook?pairName=BTC/USDT")
    out(mode="errors", case="GET orderBook", status=s, body=b[:200].decode(errors="replace"))


def mode_trades() -> None:
    for pair in ("BTC/USDT", "ETH/USDT", "ZEUS/USDT", "MOBIS/USDT"):
        s, _, b, _ = call("POST", f"{API}/ticker/publicSign", form={"pairName": pair})
        rows = json.loads(b).get("data") or []
        stamps = sorted(r.split("|")[3] for r in rows)  # side|price|amount|yyyyMMddHHmmss
        out(mode="trades", pair=pair, status=s, rows=len(rows), first=rows[0] if rows else None, oldest=stamps[0] if stamps else None, newest=stamps[-1] if stamps else None)


def mode_time() -> None:
    s, hd, _, ms = book("BTC/USDT")
    server = email.utils.parsedate_to_datetime(hd.get("Date") or hd.get("date")).timestamp()
    local = time.time() - ms / 2000
    out(mode="time", server_date=hd.get("Date") or hd.get("date"), offset_s=round(server - local, 2), note="Date has 1 s resolution")


MODES = {"host": mode_host, "catalog": mode_catalog, "book": mode_book, "mirror": mode_mirror, "poll": mode_poll, "errors": mode_errors, "trades": mode_trades, "time": mode_time}

if __name__ == "__main__":
    for m in sys.argv[1:] or list(MODES):
        MODES[m]()
