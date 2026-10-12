# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Bitonic, public price calls only.

Bitonic is a bitcoin broker with one pair, BTC against EUR, and no order book.
Its former order book exchange BL3P closed on 2024-12-20.

Modes, all by default, or name some on the command line:
    host      DNS for the site and the old BL3P hosts, cold and warm time of /api/price
    docs      the public API page, with the endpoints and the rate limit sentence it names
    quotes    /api/buy and /api/sell at several sizes and payment methods, and /api/price
    internal  the undocumented price calls the site itself uses, /api/prices/v1/last-price and /api/hourly-price
    bl3p      the old BL3P site and API hosts, to show what is left of the exchange
    errors    a bad amount, an unknown payment method and an unknown path
    poll      /api/price every 7 s for about 60 s, counting how often the price changes
    time      the HTTP Date header against the local clock

Every call is unauthenticated.
The API page asks for at most 10 requests per minute, so the probe waits 7 s between calls to bitonic.nl.
A full run makes about 35 calls to bitonic.nl in about 5 minutes.

Run from the repository root:
    uv run scripts/probes/venues/bitonic/rest-probe.py [mode ...]
"""

import email.utils
import html
import json
import re
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

SITE = "https://bitonic.nl"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json, text/html"}
GAP_S = 7.0
_last: dict[str, float] = {}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


_opener = urllib.request.build_opener(NoRedirect)


def get(url: str) -> tuple[int, dict, bytes, float]:
    host = url.split("/")[2]
    gap = GAP_S if host == "bitonic.nl" else 1.0
    wait = _last.get(host, 0.0) + gap - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with _opener.open(req, timeout=20) as r:
            status, hdrs, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, dict(e.headers), e.read()
    except (urllib.error.URLError, ssl.SSLError, TimeoutError) as e:
        status, hdrs, body = 0, {}, repr(getattr(e, "reason", e)).encode()
    ms = (time.perf_counter() - t0) * 1000
    _last[host] = time.monotonic()
    return status, hdrs, body, ms


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def text_of(body: bytes) -> list[str]:
    t = body.decode(errors="replace")
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", t, flags=re.S)
    t = html.unescape(re.sub(r"<[^>]+>", "\n", t))
    return [ln.strip() for ln in t.split("\n") if ln.strip()]


def interesting_headers(h: dict) -> dict:
    low = {k.lower(): v for k, v in h.items()}
    keys = ("server", "cache-control", "age", "x-cache", "cf-ray", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "ratelimit", "content-type")
    return {k: low[k] for k in keys if k in low}


def call(mode: str, path: str, url: str | None = None) -> dict | None:
    s, h, b, ms = get(url or SITE + path)
    try:
        d = json.loads(b)
    except ValueError:
        d = None
    out(mode=mode, call="GET " + (url or path), status=s, ms=round(ms), bytes=len(b),
        headers=interesting_headers(h), body=d if d is not None else b[:200].decode(errors="replace"))
    return d


def mode_host() -> None:
    for host in ("bitonic.nl", "api.bitonic.nl", "bl3p.eu", "api.bl3p.eu"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [repr(e)]
        out(mode="host", host=host, addresses=addrs)
    times = []
    for _ in range(3):
        s, h, b, ms = get(SITE + "/api/price")
        times.append(round(ms))
    out(mode="host", call="GET /api/price", status=s, ms_cold_then_warm=times, headers=interesting_headers(h))


def mode_docs() -> None:
    s, h, b, ms = get(SITE + "/en/api")
    lines = text_of(b)
    endpoints = sorted({m for ln in lines for m in re.findall(r"https://bitonic\.nl/api/[a-z]+", ln)})
    limit = [ln for ln in lines if "requests per minute" in ln]
    raw = b.decode(errors="replace").lower()
    words = {w: (w in raw) for w in ("websocket", "wss://", "orderbook", "order book", "futures", "perpetual", "funding", "leverage")}
    out(mode="docs", call="GET /en/api", status=s, bytes=len(b), endpoints=endpoints, rate_limit_sentence=limit, words_present=words)


def mode_quotes() -> None:
    for path in ("/api/buy", "/api/sell", "/api/price",
                 "/api/buy?eur=100", "/api/buy?method=bancontact&btc=0.01",
                 "/api/sell?btc=0.01", "/api/sell?eur=1000",
                 "/api/buy?btc=10", "/api/sell?btc=10"):
        call("quotes", path)


def mode_internal() -> None:
    call("internal", "/api/price?eur=40&include_fee=0")
    call("internal", "/api/prices/v1/last-price")
    s, h, b, ms = get(SITE + "/api/hourly-price")
    try:
        d = json.loads(b)
    except ValueError:
        d = None
    summary = None
    if isinstance(d, list):
        summary = {"rows": len(d), "first": d[:1], "last": d[-1:]}
    elif isinstance(d, dict):
        summary = {"keys": sorted(d)[:20]}
        for k, v in d.items():
            if isinstance(v, list):
                summary[k] = {"rows": len(v), "first": v[:1], "last": v[-1:]}
    out(mode="internal", call="GET /api/hourly-price", status=s, ms=round(ms), bytes=len(b), headers=interesting_headers(h),
        summary=summary if summary else b[:200].decode(errors="replace"))


def mode_bl3p() -> None:
    for url in ("https://bl3p.eu/", "https://api.bl3p.eu/1/BTCEUR/ticker", "https://api.bl3p.eu/1/BTCEUR/orderbook",
                "https://api.bl3p.eu/1/BTCEUR/trades", f"{SITE}/bl3p"):
        s, h, b, ms = get(url)
        low = {k.lower(): v for k, v in h.items()}
        out(mode="bl3p", call="GET " + url, status=s, location=low.get("location"), server=low.get("server"),
            body=b[:120].decode(errors="replace").replace("\n", " "))


def mode_errors() -> None:
    call("errors", "/api/buy?btc=abc")
    call("errors", "/api/buy?method=unknownmethod")
    call("errors", "/api/orderbook")


def mode_poll() -> None:
    seen = []
    t_end = time.monotonic() + 60
    while time.monotonic() < t_end:
        s, h, b, ms = get(SITE + "/api/price")
        try:
            d = json.loads(b)
        except ValueError:
            d = {}
        seen.append((round(time.time(), 1), s, d.get("price"), d.get("volume")))
    prices = [p for _, _, p, _ in seen]
    changes = sum(1 for a, b in zip(prices, prices[1:]) if a != b)
    out(mode="poll", call="GET /api/price every 7 s", samples=len(seen), price_changes=changes,
        statuses=sorted({s for _, s, _, _ in seen}), rows=seen)


def mode_time() -> None:
    s, h, b, ms = get(SITE + "/api/price")
    local = time.time()
    date = {k.lower(): v for k, v in h.items()}.get("date")
    server = email.utils.parsedate_to_datetime(date).timestamp() if date else None
    out(mode="time", call="GET /api/price", date_header=date,
        offset_s=round(server - local, 1) if server else None, note="Date has one second resolution")


MODES = {"host": mode_host, "docs": mode_docs, "quotes": mode_quotes, "internal": mode_internal,
         "bl3p": mode_bl3p, "errors": mode_errors, "poll": mode_poll, "time": mode_time}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="bitonic rest", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for name in picked:
        MODES[name]()
