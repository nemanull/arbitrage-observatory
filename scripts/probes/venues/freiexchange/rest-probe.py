# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for FreiExchange, public market data only.

Modes, all by default, or name some on the command line:
    host     DNS for both hosts, cold and warm request time to the API host, the web site answer
    docs     the documentation page the API host serves at its root, its rate limit sentence and endpoints
    catalog  /public/ticker for every pair, counts by quote coin, active pairs, and the web market list
    book     /public/orderbook for LTC_BTC, DOGE_BTC and DOGE_LTC, level order, repeated prices, crossed check,
             and the web site's own sell and buy arrays for LTC_BTC beside the API book
    poll     /public/orderbook/LTC for 40 s, one call about every 3 s, counting how often the top of book changes
    errors   an unknown coin, an unknown quote, an undocumented path
    time     the HTTP Date header against the local clock

Every call is unauthenticated.
The documentation page says 30 requests per 60 seconds per IP, so the probe waits 2.5 s between calls.
A full run makes about 30 requests, spread over about 90 s.

Run from the repository root:
    uv run scripts/probes/venues/freiexchange/rest-probe.py [mode ...]
"""

import email.utils
import html
import http.client
import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request

API = "https://api.freiexchange.com"
SITE = "https://freiexchange.com"
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}
GAP_S = 2.5
_last = [0.0]
KEEP_HEADERS = ("server", "content-type", "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after", "cache-control", "cf-cache-status", "age")


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


def host_mode() -> None:
    for name in ("api.freiexchange.com", "freiexchange.com"):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        out(mode="host", host=name, addresses=addrs)
    conn = http.client.HTTPSConnection("api.freiexchange.com", timeout=20)
    times = []
    for i in range(3):
        time.sleep(GAP_S)
        t0 = time.perf_counter()
        conn.request("GET", "/public/ticker/LTC", headers=UA)
        r = conn.getresponse()
        r.read()
        times.append(round((time.perf_counter() - t0) * 1000))
    conn.close()
    _last[0] = time.monotonic()
    out(mode="host", call="GET /public/ticker/LTC on one connection", cold_ms=times[0], warm_ms=times[1:], status=r.status, cf_ray=r.getheader("cf-ray"))
    s, h, b, ms = get(SITE + "/")
    title = re.search(rb"<title>(.*?)</title>", b)
    out(mode="host", call="GET / on the web site", status=s, ms=ms, title=title.group(1).decode() if title else None, headers=kept(h))


def docs_mode() -> None:
    s, h, b, ms = get(API + "/")
    text = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", b.decode(errors="replace"))
    text = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", text)))
    limit = re.search(r"The API is rate limited[^.]*\.", text)
    endpoints = sorted(set(re.findall(r"https://api\.freiexchange\.com/public/[a-z]+(?:/ ?\{COIN\}(?: /LTC)?)?", text)))
    out(mode="docs", status=s, ms=ms, bytes=len(b), title=re.search(r"^\s*(\S.*?Documentation)", text).group(1) if "Documentation" in text else None,
        rate_limit=limit.group(0) if limit else None, endpoints=endpoints,
        mentions={w: (w.lower() in text.lower()) for w in ("websocket", "private", "funding", "futures", "perpetual", "fee", "time")})


def catalog_mode() -> None:
    s, h, b, ms = get(API + "/public/ticker")
    d = json.loads(b)
    keys = list(d)
    quotes: dict = {}
    for k in keys:
        quotes[k.split("_", 1)[1]] = quotes.get(k.split("_", 1)[1], 0) + 1
    rows = [r for v in d.values() for r in v]
    traded = [k for k in keys if float(d[k][0]["volume24h"]) > 0]
    two_sided = [k for k in keys if float(d[k][0]["highestBuy"]) > 0 and float(d[k][0]["lowestSell"]) > 0]
    crossed = [k for k in two_sided if float(d[k][0]["highestBuy"]) >= float(d[k][0]["lowestSell"])]
    ids = [r["marketid"] for r in rows]
    bases = [k.split("_", 1)[0] for k in keys]
    out(mode="catalog", call="GET /public/ticker", status=s, ms=ms, bytes=len(b), headers=kept(h), pairs=len(keys), by_quote=quotes,
        rows_per_pair=sorted({len(v) for v in d.values()}), unique_marketids=len(set(ids)),
        pairs_with_volume_24h=len(traded), two_sided_pairs=len(two_sided), crossed_pairs=crossed,
        coins_on_both_quotes=len([c for c in set(bases) if bases.count(c) > 1]),
        row_fields=sorted(rows[0].keys()), sample={keys[0]: d[keys[0]][0]},
        quote_volume_fields=sorted({f for r in rows for f in r if f.startswith("volume24h_")}))
    top = sorted(traded, key=lambda k: -float(d[k][0].get("volume24h_btc") or d[k][0].get("volume24h_ltc") or 0))[:5]
    out(mode="catalog", top_by_quote_volume=[{k: {f: d[k][0][f] for f in ("volume24h", "last", "highestBuy", "lowestSell") }} for k in top])
    s, h, b, ms = get(SITE + "/market/getmarketlist")
    m = json.loads(b)["data"]
    out(mode="catalog", call="GET /market/getmarketlist on the web site", status=s, ms=ms, rows=len(m), fields=sorted(m[0].keys()),
        quotes=sorted({r["url"].rsplit("/", 1)[1] for r in m}))


def book_stats(name: str, url: str) -> dict | None:
    s, h, b, ms = get(url)
    if s != 200:
        out(mode="book", pair=name, status=s, body=b[:200].decode(errors="replace"))
        return None
    d = json.loads(b)
    buy, sell = d.get("BUY") or [], d.get("SELL") or []
    bp = [float(x["price"]) for x in buy]
    sp = [float(x["price"]) for x in sell]
    res = {
        "mode": "book", "pair": name, "url": url, "status": s, "ms": ms, "bytes": len(b), "headers": kept(h),
        "top_keys": sorted(d.keys()), "level_fields": sorted(buy[0].keys()) if buy else None,
        "buy_levels": len(buy), "sell_levels": len(sell),
        "buy_descending": bp == sorted(bp, reverse=True), "sell_ascending": sp == sorted(sp),
        "repeated_buy_prices": len(bp) - len(set(bp)), "repeated_sell_prices": len(sp) - len(set(sp)),
        "best_bid": buy[0]["price"] if buy else None, "best_ask": sell[0]["price"] if sell else None,
        "crossed": bool(bp and sp and max(bp) >= min(sp)),
        "first_buy": buy[0] if buy else None, "first_sell": sell[0] if sell else None,
    }
    out(**res)
    return res


def book_mode() -> None:
    api = book_stats("LTC_BTC", API + "/public/orderbook/LTC")
    book_stats("DOGE_BTC", API + "/public/orderbook/DOGE")
    book_stats("DOGE_LTC", API + "/public/orderbook/DOGE/LTC")
    web = {}
    for side in ("sell", "buy"):
        s, h, b, ms = get(SITE + f"/market/get{side}array/LTC/BTC")
        rows = json.loads(b) if s == 200 else []
        p = [float(r["price"]) for r in rows]
        web[side] = rows[0]["price"] if rows else None
        out(mode="book", call=f"GET /market/get{side}array/LTC/BTC on the web site", status=s, ms=ms, levels=len(rows),
            fields=sorted(rows[0].keys()) if rows else None, first=rows[0] if rows else None,
            ascending=p == sorted(p), descending=p == sorted(p, reverse=True), repeated_prices=len(p) - len(set(p)))
    if api:
        out(mode="book", compare="LTC_BTC API book against web arrays", api_best_bid=api["best_bid"], api_best_ask=api["best_ask"],
            web_best_bid=web.get("buy"), web_best_ask=web.get("sell"))


def poll_mode() -> None:
    tops = []
    t_end = time.monotonic() + 40
    while time.monotonic() < t_end:
        s, h, b, ms = get(API + "/public/orderbook/LTC")
        if s != 200:
            out(mode="poll", status=s, body=b[:200].decode(errors="replace"), headers=kept(h))
            break
        d = json.loads(b)
        top = ((d["BUY"] or [{}])[0].get("price"), (d["BUY"] or [{}])[0].get("amount"), (d["SELL"] or [{}])[0].get("price"), (d["SELL"] or [{}])[0].get("amount"))
        tops.append(top)
        out(mode="poll", t=time.strftime("%H:%M:%S", time.gmtime()), ms=ms, top=top, ratelimit_remaining=h.get("x-ratelimit-remaining"))
    changes = sum(1 for a, b in zip(tops, tops[1:]) if a != b)
    out(mode="poll", summary=True, polls=len(tops), top_changes=changes)


def errors_mode() -> None:
    for path in ("/public/ticker/NOPE", "/public/orderbook/NOPE", "/public/orderbook/LTC/ETH", "/public/markets"):
        s, h, b, ms = get(API + path)
        out(mode="errors", call="GET " + path, status=s, ms=ms, content_type=h.get("content-type"), body=b[:200].decode(errors="replace"))


def time_mode() -> None:
    s, h, b, ms = get(API + "/public/ticker/LTC")
    local = time.time()
    server = email.utils.parsedate_to_datetime(h["date"]).timestamp()
    out(mode="time", date_header=h["date"], offset_s=round(server - local + ms / 2000, 1), note="Date has 1 s resolution, no server time call is documented")


def main() -> None:
    modes = sys.argv[1:] or ["host", "docs", "catalog", "book", "poll", "errors", "time"]
    fns = {"host": host_mode, "docs": docs_mode, "catalog": catalog_mode, "book": book_mode, "poll": poll_mode, "errors": errors_mode, "time": time_mode}
    out(probe="freiexchange rest", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=modes)
    for m in modes:
        fns[m]()


if __name__ == "__main__":
    main()
