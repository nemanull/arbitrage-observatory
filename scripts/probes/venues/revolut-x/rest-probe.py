# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for Revolut X, a spot exchange with no perpetuals.

Sections, all by default, or name some on the command line:
    host      DNS, cold and warm request time, response headers of the public host.
    catalog   /1.0/public/configuration/pairs and /currencies, unfiltered and per region.
    tickers   /1.0/public/tickers, unfiltered, per region and for two symbols, with the index_price field.
    book      /2.0/public/order-book/{symbol} at several limits and both regions, the deprecated 1.0 book,
              a pair outside the default region, an unknown symbol, and a bad region.
    poll      the 2.0 book for BTC-USD and the tickers for BTC-USD, alternating, one request every 1.25 s for 60 s,
              to see how often the book timestamp, the top of book and index_price change.
    other     candles, trades/all, the deprecated last-trades, and an authenticated path without credentials.
    clock     the Date header against the local clock.

Every request is spaced by at least 1.25 s, inside the published limit of one request per second per endpoint.

Run from the repository root:
    uv run scripts/probes/venues/revolut-x/rest-probe.py [section ...]
"""

import http.client
import json
import socket
import statistics
import sys
import time
from email.utils import parsedate_to_datetime

HOST = "revx.revolut.com"
BASE = f"https://{HOST}/api"
GAP_S = 1.25
_last = [0.0]


def out(section: str, **kw) -> None:
    print(json.dumps({"section": section, **kw}, ensure_ascii=False, default=str), flush=True)


_conn: list = [None]


def get(path: str) -> dict:
    """One GET on a kept-alive connection, so the first request pays the handshake and later ones do not."""
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    url = BASE + path
    t0 = time.perf_counter()
    for attempt in (0, 1):
        if _conn[0] is None:
            _conn[0] = http.client.HTTPSConnection(HOST, timeout=20)
        try:
            _conn[0].request("GET", "/api" + path, headers={"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"})
            r = _conn[0].getresponse()
            body, status, headers = r.read(), r.status, dict(r.getheaders())
            break
        except (http.client.HTTPException, OSError):
            _conn[0].close()
            _conn[0] = None
            if attempt:
                raise
    ms = round((time.perf_counter() - t0) * 1000, 1)
    _last[0] = time.monotonic()
    try:
        js = json.loads(body)
    except ValueError:
        js = None
    return {"url": url, "status": status, "ms": ms, "bytes": len(body), "headers": headers, "json": js, "text": body[:300].decode(errors="replace")}


def section_host() -> None:
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)})
    out("host", resolved=addrs)
    times = []
    for i in range(4):
        r = get("/1.0/public/configuration/currencies?region=UK")
        times.append(r["ms"])
        if i == 0:
            keep = {k: v for k, v in r["headers"].items() if k.lower() not in ("set-cookie",)}
            out("host", first_headers=keep)
    out("host", cold_ms=times[0], warm_ms=times[1:], warm_median_ms=statistics.median(times[1:]))


def pair_summary(js) -> dict:
    data = js.get("data", js) if isinstance(js, dict) else {}
    pairs = list(data.values())
    statuses: dict = {}
    quotes: dict = {}
    for p in pairs:
        statuses[p.get("status")] = statuses.get(p.get("status"), 0) + 1
        if p.get("status") == "active":
            quotes[p.get("quote")] = quotes.get(p.get("quote"), 0) + 1
    keys_ok = all(k == f"{p.get('base')}/{p.get('quote')}" for k, p in data.items())
    return {"pairs": len(pairs), "by_status": statuses, "active_by_quote": dict(sorted(quotes.items(), key=lambda x: -x[1])),
            "key_is_base_slash_quote": keys_ok, "field_names": sorted({k for p in pairs for k in p}),
            "sample": data.get("BTC/USD")}


def section_catalog() -> None:
    region_sets = {}
    for q in ("", "?region=UK", "?region=EEA"):
        r = get("/1.0/public/configuration/pairs" + q)
        out("catalog", url=r["url"], status=r["status"], bytes=r["bytes"], ms=r["ms"], **pair_summary(r["json"] or {}))
        if r["status"] == 200:
            region_sets[q or "all"] = set((r["json"].get("data", r["json"])).keys())
    if len(region_sets) == 3:
        uk, eea = region_sets["?region=UK"], region_sets["?region=EEA"]
        out("catalog", only_uk=sorted(uk - eea), only_eea=sorted(eea - uk), both=len(uk & eea),
            all_equals_union=region_sets["all"] == (uk | eea))
    r = get("/1.0/public/configuration/currencies")
    data = r["json"].get("data", r["json"]) if isinstance(r["json"], dict) else {}
    kinds: dict = {}
    for c in data.values():
        kinds[c.get("asset_type")] = kinds.get(c.get("asset_type"), 0) + 1
    out("catalog", url=r["url"], status=r["status"], currencies=len(data), by_asset_type=kinds,
        field_names=sorted({k for c in data.values() for k in c}), sample=data.get("BTC"))


def section_tickers() -> None:
    for q in ("", "?region=UK", "?region=EEA", "?symbols=BTC-USD,ETH-USD"):
        r = get("/1.0/public/tickers" + q)
        rows = (r["json"] or {}).get("data") or []
        regions: dict = {}
        for t in rows:
            regions[t.get("region")] = regions.get(t.get("region"), 0) + 1
        symbols = [t.get("symbol") for t in rows]
        no_index = sum(1 for t in rows if not t.get("index_price"))
        out("tickers", url=r["url"], status=r["status"], bytes=r["bytes"], ms=r["ms"], rows=len(rows), by_region=regions,
            distinct_symbols=len(set(symbols)), rows_without_index_price=no_index,
            metadata=(r["json"] or {}).get("metadata"), btc=[t for t in rows if t.get("symbol") == "BTC/USD"])


def book_summary(r: dict) -> dict:
    js = r["json"] or {}
    d = js.get("data") or {}
    bids, asks = d.get("bids") or [], d.get("asks") or []
    pk = "price" if (bids or asks) and "price" in (bids or asks)[0] else "p"
    bp = [float(x[pk]) for x in bids]
    ap = [float(x[pk]) for x in asks]
    return {"url": r["url"], "status": r["status"], "bytes": r["bytes"], "ms": r["ms"], "bids": len(bids), "asks": len(asks),
            "level_keys": sorted((bids or asks)[0]) if (bids or asks) else None,
            "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
            "best_bid": bp[0] if bp else None, "best_ask": ap[0] if ap else None,
            "metadata": js.get("metadata"), "cache_control": r["headers"].get("Cache-Control") or r["headers"].get("cache-control"),
            "error": None if r["status"] == 200 else r["text"]}


def section_book() -> None:
    for q in ("", "?limit=5", "?limit=50", "?limit=100", "?limit=192", "?limit=193", "?limit=500", "?limit=1000", "?limit=0", "?region=UK", "?region=EEA&limit=1000"):
        out("book", **book_summary(get("/2.0/public/order-book/BTC-USD" + q)))
    out("book", **book_summary(get("/2.0/public/order-book/ETH-EUR?limit=1000")))
    for path in ("/2.0/public/order-book/BTC-GBP?limit=5", "/2.0/public/order-book/BTC-GBP?limit=5&region=UK",
                 "/2.0/public/order-book/BTC-EUR?limit=5&region=UK"):
        out("book", region_check=True, **book_summary(get(path)))
    r = get("/1.0/public/order-book/BTC-USD")
    s = book_summary(r)
    s["first_level"] = ((r["json"] or {}).get("data") or {}).get("bids", [None])[0]
    out("book", deprecated=True, **s)
    for path in ("/2.0/public/order-book/NOPE-USD", "/2.0/public/order-book/BTCUSD", "/2.0/public/order-book/BTC-USD?region=US"):
        r = get(path)
        out("book", url=r["url"], status=r["status"], body=r["text"])


def section_poll() -> None:
    end = time.monotonic() + 60
    books, ticks = [], []
    while time.monotonic() < end:
        r = get("/2.0/public/order-book/BTC-USD?limit=5")
        if r["status"] == 200:
            d = r["json"]["data"]
            books.append((r["json"]["metadata"].get("timestamp"), d["bids"][0]["price"], d["asks"][0]["price"], json.dumps(d)))
        else:
            out("poll", book_status=r["status"], body=r["text"], headers=r["headers"])
        r = get("/1.0/public/tickers?symbols=BTC-USD&region=EEA")
        if r["status"] == 200 and r["json"]["data"]:
            t = r["json"]["data"][0]
            ticks.append((r["json"]["metadata"].get("timestamp"), t.get("index_price"), t.get("bid"), t.get("ask"), t.get("last_price")))
        else:
            out("poll", ticker_status=r["status"], body=r["text"], headers=r["headers"])

    def changes(rows, i):
        return sum(1 for a, b in zip(rows, rows[1:]) if a[i] != b[i])

    local_gap = [round((b[0] - a[0]) / 1000, 2) for a, b in zip(books, books[1:]) if a[0] and b[0]]
    out("poll", book_polls=len(books), book_timestamp_changes=changes(books, 0), book_content_changes=changes(books, 3),
        best_bid_changes=changes(books, 1), best_ask_changes=changes(books, 2), book_timestamp_gaps_s=local_gap,
        ticker_polls=len(ticks), index_price_changes=changes(ticks, 1), ticker_bid_changes=changes(ticks, 2),
        ticker_timestamp_changes=changes(ticks, 0), first_ticker=ticks[0] if ticks else None, last_ticker=ticks[-1] if ticks else None)


def section_other() -> None:
    now = int(time.time() * 1000)
    for path in (f"/1.0/public/candles/BTC-USD?interval=60&since={now - 6 * 3600_000}",
                 "/1.0/public/trades/all?symbol=BTC-USD&limit=5",
                 "/1.0/public/last-trades",
                 "/1.0/configuration/pairs",
                 "/1.0/tickers"):
        r = get(path)
        js = r["json"]
        rows = js.get("data") if isinstance(js, dict) else js
        out("other", url=r["url"], status=r["status"], bytes=r["bytes"], rows=len(rows) if isinstance(rows, list) else None,
            first=rows[0] if isinstance(rows, list) and rows else None, metadata=js.get("metadata") if isinstance(js, dict) else None,
            body=None if r["status"] == 200 else r["text"])


def section_clock() -> None:
    offsets = []
    for _ in range(3):
        t0 = time.time()
        r = get("/1.0/public/tickers?symbols=BTC-USD")
        t1 = time.time()
        date = r["headers"].get("Date") or r["headers"].get("date")
        server = parsedate_to_datetime(date).timestamp()
        meta = (r["json"] or {}).get("metadata", {}).get("timestamp")
        offsets.append({"date_header": date, "date_minus_local_mid_s": round(server - (t0 + t1) / 2, 3),
                        "metadata_ts_minus_local_mid_ms": round(meta - (t0 + t1) / 2 * 1000) if meta else None})
    out("clock", samples=offsets)


SECTIONS = {"host": section_host, "catalog": section_catalog, "tickers": section_tickers, "book": section_book,
            "poll": section_poll, "other": section_other, "clock": section_clock}

if __name__ == "__main__":
    names = sys.argv[1:] or list(SECTIONS)
    out("start", utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), sections=names)
    for n in names:
        SECTIONS[n]()
