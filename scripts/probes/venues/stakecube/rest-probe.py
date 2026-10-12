# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for StakeCube, public market data only.

Modes, all by default, or name some on the command line:
    host     DNS for the API host and the web host, cold and warm request time, the API host root page
    limits   /system/rateLimits and the x-mbx-used-weight headers one call returns
    catalog  /exchange/spot/markets, counts by state and by quote coin, pairs with 24 h volume, key spelling,
             the orderData=true shape for one market, and the arbitrageInfo reply age
    book     /exchange/spot/orderbook for three markets, depth, level order, repeated prices, crossed check,
             the side=BUY filter, and the bestBid and bestAsk of /markets?orderData=true beside the book
    poll     /exchange/spot/orderbook?market=DASH_SCC every 2 s for 40 s, counting top of book changes
    errors   an unknown market, a missing market, a bad side, a lower case market, an undocumented path
    time     the reply timestamp and the HTTP Date header against the local clock

Every call is unauthenticated.
/system/rateLimits publishes 20 weight per 10 s, 1,200 per minute and 100,000 per day, and each call here weighs 1.
The probe waits 1.2 s between calls, and a full run makes about 45 requests over about 90 s.

Run from the repository root:
    uv run scripts/probes/venues/stakecube/rest-probe.py [mode ...]
"""

import email.utils
import http.client
import json
import socket
import sys
import time
import urllib.error
import urllib.request

API = "https://stakecube.io/api/v2"
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}
GAP_S = 1.2
_last = [0.0]
KEEP_HEADERS = (
    "server",
    "content-type",
    "cache-control",
    "retry-after",
    "x-mbx-used-weight-10s",
    "x-mbx-used-weight-1m",
    "x-mbx-used-weight-1d",
)


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str) -> tuple[int, dict, bytes, float]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, hdrs, body = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    ms = round((time.perf_counter() - t0) * 1000)
    _last[0] = time.monotonic()
    return status, hdrs, body, ms


def kept(h: dict) -> dict:
    return {k: h[k] for k in KEEP_HEADERS if k in h}


FAILED = []  # replies with success false, which the server sends with HTTP 200 on transient backend errors


def get_json(path: str, tries: int = 3):
    for _ in range(tries):
        status, hdrs, body, ms = get(API + path)
        try:
            doc = json.loads(body)
        except ValueError:
            doc = None
        if isinstance(doc, dict) and doc.get("success") is False and doc.get("error") != "no data":
            FAILED.append({"path": path, "status": status, "error": doc.get("error"), "result": doc.get("result")})
            out(mode="failed-reply", path=path, status=status, body=doc)
            continue
        break
    return status, hdrs, body, ms, doc


def host_mode() -> None:
    for name in ("stakecube.io", "stakecube.net"):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        out(mode="host", host=name, addresses=addrs)
    times = []
    conn = http.client.HTTPSConnection("stakecube.io", timeout=20)
    for _ in range(4):
        time.sleep(GAP_S)
        t0 = time.perf_counter()
        conn.request("GET", "/api/v2/exchange/spot/orderbook?market=SCC_BTC", headers=UA)
        r = conn.getresponse()
        r.read()
        times.append(round((time.perf_counter() - t0) * 1000))
    conn.close()
    out(mode="host", call="orderbook SCC_BTC on one connection", first_ms_cold=times[0], warm_ms=times[1:])
    status, hdrs, body, ms = get("https://stakecube.io/")
    out(mode="host", url="https://stakecube.io/", status=status, ms=ms, body=body.decode(errors="replace")[:300])


def limits_mode() -> None:
    status, hdrs, body, ms, doc = get_json("/system/rateLimits")
    out(mode="limits", status=status, ms=ms, headers=kept(hdrs), result=(doc or {}).get("result"))


def catalog_mode() -> None:
    status, hdrs, body, ms, doc = get_json("/exchange/spot/markets")
    res = doc["result"]
    by_state, by_quote, by_quote_vol = {}, {}, {}
    mismatched = []
    for key, m in res.items():
        by_state[m["state"]] = by_state.get(m["state"], 0) + 1
        by_quote[m["baseMarket"]] = by_quote.get(m["baseMarket"], 0) + 1
        if float(m["volumeBase24h"]) > 0:
            by_quote_vol[m["baseMarket"]] = by_quote_vol.get(m["baseMarket"], 0) + 1
        if key != f"{m['tradeMarket']}_{m['baseMarket']}":
            mismatched.append({"key": key, "tradeMarket": m["tradeMarket"], "baseMarket": m["baseMarket"]})
    top = sorted(((float(m["volumeBase24h"]), k) for k, m in res.items()), reverse=True)[:8]
    out(
        mode="catalog",
        status=status,
        ms=ms,
        bytes=len(body),
        headers=kept(hdrs),
        pairs=len(res),
        by_state=by_state,
        by_quote=by_quote,
        pairs_with_volume_by_quote=by_quote_vol,
        pairs_with_volume=sum(by_quote_vol.values()),
        top_by_quote_volume=top,
        key_not_trade_underscore_base=mismatched,
        fields=sorted(next(iter(res.values())).keys()),
        sample=res.get("SCC_BTC"),
        btc_usdt=res.get("BTC_USDT"),
    )
    status, hdrs, body, ms, doc = get_json("/exchange/spot/markets?orderData=true&market=DASH_SCC")
    m = doc["result"]["DASH_SCC"]
    out(mode="catalog", call="markets orderData=true market=DASH_SCC", status=status, ms=ms, fields=sorted(m.keys()),
        bestBid=m.get("bestBid"), bestAsk=m.get("bestAsk"), bids_len=len(m.get("bids", [])), asks_len=len(m.get("asks", [])))
    status, hdrs, body, ms, doc = get_json("/exchange/spot/arbitrageInfo?ticker=DASH")
    rows = doc.get("result") or []
    stamps = sorted({r.get("timestamp") for r in rows if r.get("timestamp")})
    out(mode="catalog", call="arbitrageInfo ticker=DASH", status=status, ms=ms, rows=len(rows),
        oldest_timestamp=stamps[0] if stamps else None, newest_timestamp=stamps[-1] if stamps else None,
        sample_keys=sorted(rows[0].keys()) if rows else None)


def book_stats(levels: list, descending: bool) -> dict:
    prices = [float(x["price"]) for x in levels]
    ordered = prices == sorted(prices, reverse=descending)
    return {"levels": len(levels), "first": levels[0] if levels else None, "last": levels[-1] if levels else None,
            "ordered_as_expected": ordered, "repeated_prices": len(prices) - len(set(prices))}


def book_mode() -> None:
    for market in ("SCC_BTC", "DASH_SCC", "BTC_USDT"):
        status, hdrs, body, ms, doc = get_json(f"/exchange/spot/orderbook?market={market}")
        res = doc.get("result") or {}
        bids, asks = res.get("bids", []), res.get("asks", [])
        best_bid = max((float(x["price"]) for x in bids), default=None)
        best_ask = min((float(x["price"]) for x in asks), default=None)
        out(mode="book", market=market, status=status, ms=ms, bytes=len(body), headers=kept(hdrs),
            top_level_keys=sorted(doc.keys()), result_keys=sorted(res.keys()),
            bids=book_stats(bids, True), asks_descending=book_stats(asks, True), asks_ascending_check=book_stats(asks, False)["ordered_as_expected"],
            best_bid=best_bid, best_ask=best_ask, crossed=(best_bid is not None and best_ask is not None and best_bid >= best_ask))
    status, hdrs, body, ms, doc = get_json("/exchange/spot/orderbook?market=DASH_SCC&side=BUY")
    res = doc.get("result") or {}
    out(mode="book", call="orderbook DASH_SCC side=BUY", status=status, result_keys=sorted(res.keys()) if isinstance(res, dict) else type(res).__name__,
        sizes={k: len(v) for k, v in res.items()} if isinstance(res, dict) else None)
    status, hdrs, body, ms, doc = get_json("/exchange/spot/markets?orderData=true&market=DASH_SCC")
    m = doc["result"]["DASH_SCC"]
    status2, hdrs2, body2, ms2, doc2 = get_json("/exchange/spot/orderbook?market=DASH_SCC")
    b = doc2["result"]
    out(mode="book", call="markets bestBid and bestAsk beside the orderbook top, 1.2 s apart", market="DASH_SCC",
        markets_best_bid=m["bestBid"], markets_best_ask=m["bestAsk"],
        book_best_bid=max(float(x["price"]) for x in b["bids"]), book_best_ask=min(float(x["price"]) for x in b["asks"]))


def poll_mode() -> None:
    seen, changes, n, stamps = None, 0, 0, []
    t_end = time.monotonic() + 40
    while time.monotonic() < t_end:
        _last[0] = time.monotonic() + 0.8  # 2 s between polls
        status, hdrs, body, ms, doc = get_json("/exchange/spot/orderbook?market=DASH_SCC", tries=1)
        n += 1
        if not doc.get("success"):
            continue
        res = doc.get("result") or {}
        top = (res["bids"][0] if res.get("bids") else None, min(res.get("asks", []), key=lambda x: float(x["price"]), default=None))
        stamps.append(doc.get("timestamp"))
        if seen is not None and top != seen:
            changes += 1
        seen = top
        last_weight = kept(hdrs)
    out(mode="poll", market="DASH_SCC", polls=n, top_of_book_changes=changes, last_top=seen,
        distinct_reply_timestamps=len(set(stamps)), last_headers=last_weight)


def errors_mode() -> None:
    # raw get, no retry, so the error bodies show as sent
    cases = {
        "unknown market": "/exchange/spot/orderbook?market=NOPE_BTC",
        "missing market": "/exchange/spot/orderbook",
        "bad side": "/exchange/spot/orderbook?market=SCC_BTC&side=UP",
        "lower case market": "/exchange/spot/orderbook?market=scc_btc",
        "unknown markets filter": "/exchange/spot/markets?market=NOPE_BTC",
        "undocumented path": "/exchange/spot/nothing",
    }
    for name, path in cases.items():
        status, hdrs, body, ms = get(API + path)
        text = body.decode(errors="replace")
        try:
            doc = json.loads(text)
            if isinstance(doc.get("result"), dict) and len(text) > 400:
                doc["result"] = {k: (f"{len(v)} levels" if isinstance(v, list) else v) for k, v in doc["result"].items()}
            shown = doc
        except ValueError:
            shown = " ".join(text.split())[:200]
        out(mode="errors", case=name, status=status, content_type=hdrs.get("content-type"), body=shown)


def time_mode() -> None:
    # a reference clock first, so a StakeCube offset is not mistaken for local drift
    status, hdrs, body, ms = get("https://api.binance.com/api/v3/time")
    local_mid = time.time() * 1000 - ms / 2  # get() may sleep before sending, so the midpoint comes from its own timing
    out(mode="time", reference="api.binance.com serverTime", offset_ms=round(json.loads(body)["serverTime"] - local_mid), rtt_ms=ms)
    for _ in range(3):
        status, hdrs, body, ms, doc = get_json("/system/rateLimits")
        local_mid = time.time() * 1000 - ms / 2
        date_hdr = email.utils.parsedate_to_datetime(hdrs["date"]).timestamp() * 1000 if "date" in hdrs else None
        out(mode="time", reply_timestamp=doc.get("timestamp"), timestampConverted=doc.get("timestampConverted"),
            executionTime=doc.get("executionTime"), offset_ms=round(doc["timestamp"] - local_mid), rtt_ms=ms,
            date_header=hdrs.get("date"), date_offset_ms=round(date_hdr - local_mid) if date_hdr else None)


MODES = {"host": host_mode, "limits": limits_mode, "catalog": catalog_mode, "book": book_mode,
         "poll": poll_mode, "errors": errors_mode, "time": time_mode}

if __name__ == "__main__":
    chosen = sys.argv[1:] or list(MODES)
    out(probe="stakecube rest", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=chosen)
    for name in chosen:
        MODES[name]()
    out(probe="done", success_false_replies=len(FAILED), errors=sorted({f["error"] for f in FAILED}))
