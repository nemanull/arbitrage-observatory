# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Bitcoiva's Open API at apistack.bitcoiva.com, public market data only.

Modes, all by default, or name some on the command line:
    host     DNS, cold and warm request time, the site and the API root as seen from this host
    catalog  /api/v1/ticker without a symbol, counted by quote, against CoinMarketCap's spot pair list
    ticker   /api/v1/ticker?symbol=BTC_USDT
    book     /api/v1/depth for BTC_USDT at limits 5, the default, 20, 21, 50, 100, 101, 0 and 1000, level order and crossed check
    mirror   Bitcoiva's depth beside Binance's /api/v3/depth for the same pair, taken together, for USDT and INR pairs
    poll     /api/v1/depth?symbol=BTC_USDT&limit=5 every 2 s for 30 s, counting top of book changes and id steps
    errors   unknown and own-token symbols, a missing symbol, a private path without a key, and the web app's futures pair call
    time     the HTTP Date header against the local clock

Every call is unauthenticated.
The probe waits at least 0.5 s between calls to Bitcoiva, far inside the 1,200 per 60 s the API documents per IP.
The whole run makes about 50 requests.

Run from the repository root:
    uv run scripts/probes/venues/bitcoiva/rest-probe.py [mode ...]
"""

import collections
import email.utils
import json
import socket
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "https://apistack.bitcoiva.com"
SITE = "https://www.bitcoiva.com"
BINANCE = "https://api.binance.com"
FUTURE_PAIRS = "https://aztqomrbasen.bitcoiva.com/nNAgxMVIOgunfsHtQ/ctrader/viewbitcoivafuturepairs"  # userBackendURL + prefix, from the web bundle
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitcoiva&category={cat}&start=1&limit=500"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
GAP_S = 0.5
WORK = Path(".claude/survey-work/bitcoiva")
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


def post(url: str, payload: dict) -> tuple[int, bytes]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={**UA, "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    _last[0] = time.monotonic()
    return status, body


def limits(h: dict) -> dict:
    low = {k.lower(): v for k, v in h.items()}
    return {k: low.get(k) for k in ("ratelimit-policy", "ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after")}


def as_json(b: bytes):
    try:
        return json.loads(b)
    except ValueError:
        return None


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False))


def trim(b: bytes, n: int = 300) -> str:
    s = b.decode(errors="replace")
    return s if len(s) <= n else s[:n] + f"...(+{len(s) - n})"


def mode_host() -> None:
    for h in ("www.bitcoiva.com", "apistack.bitcoiva.com", "rtrxastzeqsaoqd.bitcoiva.com", "aztqomrbasen.bitcoiva.com"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
            cname = socket.gethostbyname_ex(h)[0]
        except OSError as e:
            addrs, cname = [repr(e)], None
        out(mode="host", host=h, canonical=cname, addresses=addrs)
    s, h, b, ms = get(SITE + "/")
    out(mode="host", call="site /", status=s, ms=round(ms), bytes=len(b), server=h.get("Server"), title_has_bitcoiva=b"Bitcoiva" in b)
    for i in range(3):
        s, h, b, ms = get(API + "/api/v1/ticker?symbol=BTC_USDT")
        out(mode="host", call="ticker BTC_USDT", run=i, status=s, ms=round(ms), bytes=len(b), server=h.get("Server"), powered=h.get("X-Powered-By"))
    s, h, b, ms = get(API + "/")
    out(mode="host", call="api root", status=s, ms=round(ms), body=trim(b, 160))


def mode_catalog() -> None:
    s, h, b, ms = get(API + "/api/v1/ticker")
    d = as_json(b)
    rows = d.get("data") if isinstance(d, dict) else None
    out(mode="catalog", call="ticker, no symbol", status=s, ms=round(ms), bytes=len(b), limits=limits(h), shape=type(rows).__name__)
    if isinstance(rows, list):
        q = collections.Counter(r.get("toSymbol") for r in rows)
        names = [r.get("symbol") for r in rows]
        dup = [n for n, c in collections.Counter(names).items() if c > 1]
        out(mode="catalog", rows=len(rows), by_quote=dict(q), duplicate_symbols=dup, fields=sorted(rows[0].keys()), first=rows[0])
        (WORK / "rest-catalog.json").write_text(json.dumps(rows, indent=1))
        zero = [r["symbol"] for r in rows if float(r.get("bestBid") or 0) == 0 or float(r.get("bestAsk") or 0) == 0]
        out(mode="catalog", rows_with_zero_bid_or_ask=len(zero), sample=zero[:8])
    s2, _, b2, _ = get(API + "/api/v1/ticker?pair=BTC_USDT")
    d2 = as_json(b2)
    out(mode="catalog", call="ticker?pair=BTC_USDT, the parameter the doc table names", status=s2,
        rows=len(d2["data"]) if isinstance(d2, dict) and isinstance(d2.get("data"), list) else None)
    for cat in ("spot", "perpetual", "futures"):
        s3, _, b3, _ = get(CMC.format(cat=cat), pace=False)
        d3 = as_json(b3) or {}
        mp = (d3.get("data") or {}).get("marketPairs") or []
        out(mode="catalog", source="CoinMarketCap", category=cat, status=s3, pairs=len(mp),
            by_quote=dict(collections.Counter(p["quoteSymbol"] for p in mp)),
            price_and_volume_excluded=sum(1 for p in mp if p.get("priceExcluded") == 1 and p.get("volumeExcluded") == 1))
        time.sleep(1)


def mode_ticker() -> None:
    s, h, b, ms = get(API + "/api/v1/ticker?symbol=BTC_USDT")
    out(mode="ticker", status=s, ms=round(ms), limits=limits(h), body=as_json(b))


def mode_book() -> None:
    for q in ("&limit=5", "", "&limit=20", "&limit=21", "&limit=50", "&limit=100", "&limit=101", "&limit=0", "&limit=1000"):
        s, h, b, ms = get(API + "/api/v1/depth?symbol=BTC_USDT" + q)
        d = as_json(b)
        if isinstance(d, dict) and "bids" in d:
            bids = [float(p) for p, _ in d["bids"]]
            asks = [float(p) for p, _ in d["asks"]]
            out(mode="book", query=q or "(default)", status=s, ms=round(ms), bytes=len(b), keys=sorted(d.keys()),
                lastUpdateId=d.get("lastUpdateId"), levels=[len(bids), len(asks)],
                bids_desc=bids == sorted(bids, reverse=True), asks_asc=asks == sorted(asks),
                crossed=bool(bids and asks and bids[0] >= asks[0]), top=[d["bids"][0], d["asks"][0]] if bids and asks else None,
                cache=h.get("Cache-Control"), etag=h.get("ETag"))
        else:
            out(mode="book", query=q or "(default)", status=s, ms=round(ms), body=trim(b))


def fetch_pair(results: dict, key: str, url: str) -> None:
    s, _, b, ms = get(url, pace=False)
    results[key] = (s, as_json(b), ms, time.time())


def mode_mirror() -> None:
    cases = [("BTC_USDT", "BTCUSDT"), ("ETH_USDT", "ETHUSDT"), ("XRP_USDT", "XRPUSDT"), ("BTC_INR", "BTCUSDT"), ("ETH_INR", "ETHUSDT"), ("ETH_BTC", "ETHBTC")]
    for ours, theirs in cases:
        time.sleep(1)
        res: dict = {}
        ts = [threading.Thread(target=fetch_pair, args=(res, "bitcoiva", f"{API}/api/v1/depth?symbol={ours}&limit=10")),
              threading.Thread(target=fetch_pair, args=(res, "binance", f"{BINANCE}/api/v3/depth?symbol={theirs}&limit=10"))]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        sb, db, _, _ = res["bitcoiva"]
        sn, dn, _, _ = res["binance"]
        if not (isinstance(db, dict) and "bids" in db and isinstance(dn, dict) and "bids" in dn):
            out(mode="mirror", pair=ours, bitcoiva_status=sb, binance_status=sn, bitcoiva=str(db)[:200], binance=str(dn)[:200])
            continue
        same_sizes_bids = sum(1 for a, c in zip(db["bids"], dn["bids"]) if float(a[1]) == float(c[1]))
        same_sizes_asks = sum(1 for a, c in zip(db["asks"], dn["asks"]) if float(a[1]) == float(c[1]))
        ratio = float(db["bids"][0][0]) / float(dn["bids"][0][0])
        out(mode="mirror", pair=ours, binance_symbol=theirs, bitcoiva_id=db.get("lastUpdateId"), binance_id=dn.get("lastUpdateId"),
            id_gap=(db.get("lastUpdateId") or 0) - (dn.get("lastUpdateId") or 0),
            same_size_levels=[same_sizes_bids, same_sizes_asks], of=[len(db["bids"]), len(db["asks"])],
            price_ratio_bid=round(ratio, 6), bitcoiva_top=[db["bids"][0], db["asks"][0]], binance_top=[dn["bids"][0], dn["asks"][0]])


def mode_poll() -> None:
    prev_top, prev_id, changes, steps = None, None, 0, []
    prev_book, book_changes = None, 0
    n = 0
    end = time.monotonic() + 30
    while time.monotonic() < end:
        t0 = time.monotonic()
        s, _, b, ms = get(API + "/api/v1/depth?symbol=BTC_USDT&limit=5")
        d = as_json(b) or {}
        n += 1
        top = (d.get("bids", [[None]])[0][0], d.get("asks", [[None]])[0][0])
        if prev_top is not None and top != prev_top:
            changes += 1
        book = (d.get("bids"), d.get("asks"))
        if prev_book is not None and book != prev_book:
            book_changes += 1
        prev_book = book
        if prev_id is not None and d.get("lastUpdateId"):
            steps.append(d["lastUpdateId"] - prev_id)
        prev_top, prev_id = top, d.get("lastUpdateId")
        time.sleep(max(0.0, 2 - (time.monotonic() - t0)))
    out(mode="poll", polls=n, top_price_changes=changes, five_level_changes=book_changes, id_steps_min=min(steps) if steps else None, id_steps_max=max(steps) if steps else None,
        id_never_repeats=all(x > 0 for x in steps))


def mode_errors() -> None:
    for q in ("symbol=NOPE_USDT", "symbol=BCA_USDT", "symbol=BCA_INR", "symbol=CNT_USDT", "symbol=btc_usdt", "symbol=BTCUSDT", ""):
        s, h, b, ms = get(API + "/api/v1/depth" + ("?" + q if q else ""))
        out(mode="errors", call="depth?" + q, status=s, body=trim(b, 200))
    s, h, b, ms = get(API + "/api/v1/ticker?symbol=BCA_USDT")
    out(mode="errors", call="ticker?symbol=BCA_USDT", status=s, body=trim(b, 300))
    s, b = post(API + "/api/v1/balance", {"currency": "USDT"})
    out(mode="errors", call="POST balance without a key", status=s, body=trim(b, 200))
    s, h, b, ms = get(FUTURE_PAIRS)
    d = as_json(b)
    out(mode="errors", call="web app GET ctrader/viewbitcoivafuturepairs, no token", status=s, bytes=len(b),
        keys=sorted(d.keys()) if isinstance(d, dict) else None,
        payload_prefix=(d.get("payload") or "")[:16] if isinstance(d, dict) else trim(b, 120))


def mode_time() -> None:
    offs = []
    for _ in range(3):
        t0 = time.time()
        s, h, b, ms = get(API + "/api/v1/ticker?symbol=BTC_USDT")
        t1 = time.time()
        server = email.utils.parsedate_to_datetime(h.get("Date")).timestamp() if h.get("Date") else None
        if server:
            offs.append(round(server - (t0 + t1) / 2, 2))
    out(mode="time", date_header_offsets_s=offs, note="Date has one second resolution, and the API has no time call")


MODES = {"host": mode_host, "catalog": mode_catalog, "ticker": mode_ticker, "book": mode_book, "mirror": mode_mirror,
         "poll": mode_poll, "errors": mode_errors, "time": mode_time}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    for m in sys.argv[1:] or list(MODES):
        MODES[m]()
