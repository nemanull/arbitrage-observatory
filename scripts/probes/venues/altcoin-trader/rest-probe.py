# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for Altcoin Trader, public market data only.

Modes, all by default, or name some on the command line:
    host     DNS, cold and warm request time, the web site answer and the API answer from this host
    docs     the OpenAPI document the API host serves at /docs/openapi.yaml, with its paths and server URL
    catalog  /markets and /currencies, with counts, status values and the fields on the wire
    book     /orderbook/BTCZAR at the default depth and at limit 200, level order and crossed check
    ticker   /ticker/BTCZAR and /trades/BTCZAR
    poll     /orderbook/BTCZAR?limit=5 for 40 s, one call about every 3 s, counting how often the top of book changes
    limits   the rate limit headers of /markets and /ticker/BTCZAR, 8 calls 2 s apart, with seconds until each reset
    errors   an unknown market, limit 0 and 201, a private path without a key, and the documented server host
    time     the HTTP Date header against the local clock

Every call is unauthenticated.
The probe waits 1.5 s between calls and backs off on HTTP 429 by the reset header, because the API answered 429 to bursts.
The whole run makes about 40 requests, inside the 120 per window the /markets reply advertises.

Run from the repository root:
    uv run scripts/probes/venues/altcoin-trader/rest-probe.py [mode ...]
"""

import email.utils
import json
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request

API = "https://api.altcointrader.co.za"
SITE = "https://www.altcointrader.co.za"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
GAP_S = 1.5
_last = [0.0]


def get(url: str, headers: dict | None = None) -> tuple[int, dict, bytes, float]:
    wait = _last[0] + GAP_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers=headers or UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, hdrs, body = r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, dict(e.headers), e.read()
    except (urllib.error.URLError, ssl.SSLError, TimeoutError) as e:
        status, hdrs, body = 0, {}, repr(getattr(e, "reason", e)).encode()
    ms = (time.perf_counter() - t0) * 1000
    _last[0] = time.monotonic()
    return status, hdrs, body, ms


def limits(h: dict) -> dict:
    low = {k.lower(): v for k, v in h.items()}
    return {k: low.get(k) for k in ("x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset", "retry-after")}


def get_json(path: str, tries: int = 3):
    for i in range(tries):
        s, h, b, ms = get(API + path)
        if s != 429 or i == tries - 1:
            break
        reset = limits(h).get("x-ratelimit-reset")
        pause = max(1.0, min(65.0, float(reset) - time.time() + 1)) if reset else 10.0
        out(path=path, status=429, body=b[:120].decode(errors="replace"), limits=limits(h), backoff_s=round(pause, 1))
        time.sleep(pause)
    try:
        data = json.loads(b)
    except ValueError:
        data = None
    return s, h, b, ms, data


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str))


def mode_host() -> None:
    for host in ("api.altcointrader.co.za", "www.altcointrader.co.za", "api.actnewdev.co.za"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [repr(e)]
        out(mode="host", host=host, addresses=addrs)
    times = []
    for _ in range(3):
        s, h, b, ms = get(API + "/markets")
        times.append(round(ms))
    out(mode="host", call="GET /markets", status=s, ms_cold_then_warm=times, server=h.get("Server"), limits=limits(h))
    s, h, b, ms = get(API + "/")
    out(mode="host", call="GET / on the API host", status=s, body=b[:200].decode(errors="replace"))
    for path in ("/", "/trading-fees", "/api/v3/live-stats"):
        s, h, b, ms = get(SITE + path, {"User-Agent": "Mozilla/5.0"})
        low = {k.lower(): v for k, v in h.items()}
        title = ""
        text = b.decode(errors="replace")
        if "<title>" in text:
            title = text.split("<title>", 1)[1].split("</title>", 1)[0]
        out(mode="host", call="GET " + SITE + path, status=s, title=title, cf_mitigated=low.get("cf-mitigated"), server=low.get("server"), cf_ray=low.get("cf-ray"))


def mode_docs() -> None:
    s, h, b, ms = get(API + "/docs")
    out(mode="docs", call="GET /docs", status=s, bytes=len(b), loads="/docs/openapi.yaml" in b.decode(errors="replace"))
    s, h, b, ms, _ = get_json("/docs/openapi.yaml")
    text = b.decode(errors="replace")
    lines = text.splitlines()
    paths = [ln.strip().rstrip(":") for ln in lines if ln.startswith("  /")]
    servers = [ln.split("url:", 1)[1].strip() for ln in lines if ln.strip().startswith("- url:")]
    title = next((ln.split(":", 1)[1].strip() for ln in lines if ln.strip().startswith("title:")), None)
    version = next((ln.split(":", 1)[1].strip() for ln in lines if ln.strip().startswith("version:")), None)
    words = {w: (w in text.lower()) for w in ("futures", "perpetual", "funding", "mark price", "index", "leverage", "margin", "sequence", "checksum")}
    out(mode="docs", call="GET /docs/openapi.yaml", status=s, bytes=len(b), lines=len(lines), title=title, version=version, servers=servers, paths=paths, words_present=words)


def mode_catalog() -> None:
    s, h, b, ms, d = get_json("/markets")
    if isinstance(d, list):
        fields = sorted({k for m in d for k in m})
        out(mode="catalog", call="GET /markets", status=s, ms=round(ms), bytes=len(b), count=len(d),
            status_values={v: sum(1 for m in d if m.get("status") == v) for v in sorted({m.get("status") for m in d})},
            quotes=sorted({m.get("quote") for m in d}), fields=fields,
            has_fee_fields=any("taker_fee" in m or "maker_fee" in m for m in d),
            symbols=[m.get("symbol") for m in d], sample=d[1] if len(d) > 1 else d)
    else:
        out(mode="catalog", call="GET /markets", status=s, body=b[:300].decode(errors="replace"))
    s, h, b, ms, d = get_json("/currencies")
    if isinstance(d, list):
        out(mode="catalog", call="GET /currencies", status=s, count=len(d), fields=sorted({k for c in d for k in c}), sample=d[:2])
    else:
        out(mode="catalog", call="GET /currencies", status=s, body=b[:300].decode(errors="replace"))


def summarize_book(d: dict) -> dict:
    bids, asks = d.get("bids") or [], d.get("asks") or []
    bp = [float(x[0]) for x in bids]
    ap = [float(x[0]) for x in asks]
    return {
        "keys": sorted(d), "bids": len(bids), "asks": len(asks),
        "best_bid": bids[0] if bids else None, "best_ask": asks[0] if asks else None,
        "bids_descending": bp == sorted(bp, reverse=True), "asks_ascending": ap == sorted(ap),
        "crossed": bool(bp and ap and bp[0] >= ap[0]), "timestamp": d.get("timestamp"),
        "level_types": sorted({type(v).__name__ for x in bids[:3] + asks[:3] for v in x}),
    }


def mode_book() -> None:
    for q in ("", "?limit=200"):
        s, h, b, ms, d = get_json("/orderbook/BTCZAR" + q)
        low = {k.lower(): v for k, v in h.items()}
        if isinstance(d, dict) and "bids" in d:
            out(mode="book", call="GET /orderbook/BTCZAR" + q, status=s, ms=round(ms), bytes=len(b), cache_control=low.get("cache-control"), limits=limits(h), **summarize_book(d))
        else:
            out(mode="book", call="GET /orderbook/BTCZAR" + q, status=s, body=b[:300].decode(errors="replace"))
    s, h, b, ms, d = get_json("/orderbook/BTCZAR?limit=3")
    out(mode="book", call="GET /orderbook/BTCZAR?limit=3", status=s, raw=b[:600].decode(errors="replace"))


def mode_ticker() -> None:
    s, h, b, ms, d = get_json("/ticker/BTCZAR")
    out(mode="ticker", call="GET /ticker/BTCZAR", status=s, raw=b[:500].decode(errors="replace"),
        last_trade_age_s=round(time.time() - d["timestamp"]) if isinstance(d, dict) and isinstance(d.get("timestamp"), int) else None)
    s, h, b, ms, d = get_json("/trades/BTCZAR?limit=5")
    out(mode="ticker", call="GET /trades/BTCZAR?limit=5", status=s, raw=b[:700].decode(errors="replace"))


def mode_poll() -> None:
    tops, n, errs = [], 0, []
    t_end = time.monotonic() + 40
    while time.monotonic() < t_end:
        s, h, b, ms, d = get_json("/orderbook/BTCZAR?limit=5", tries=1)
        n += 1
        if s == 200 and isinstance(d, dict):
            tops.append((json.dumps(d.get("bids", [])[:1]), json.dumps(d.get("asks", [])[:1]), d.get("timestamp")))
        else:
            errs.append(s)
        time.sleep(0.5)
    changes = sum(1 for a, c in zip(tops, tops[1:]) if a[:2] != c[:2])
    ts_changes = sum(1 for a, c in zip(tops, tops[1:]) if a[2] != c[2])
    out(mode="poll", calls=n, ok=len(tops), non_200=errs, top_of_book_changes=changes, timestamp_changes=ts_changes,
        first=tops[0] if tops else None, last=tops[-1] if tops else None)


def mode_limits() -> None:
    for i in range(8):
        path = "/markets" if i % 2 == 0 else "/ticker/BTCZAR"
        s, h, b, ms = get(API + path)
        lim = limits(h)
        reset = lim.get("x-ratelimit-reset")
        out(mode="limits", call="GET " + path, status=s, limits=lim, reset_in_s=round(float(reset) - time.time(), 1) if reset else None,
            body=b[:120].decode(errors="replace") if s != 200 else None)
        time.sleep(0.5)


def mode_errors() -> None:
    for path in ("/orderbook/NOPEZAR", "/ticker/NOPEZAR", "/orderbook/btczar", "/orderbook/BTCZAR?limit=0", "/orderbook/BTCZAR?limit=201", "/balances", "/v1/markets"):
        s, h, b, ms, d = get_json(path)
        out(mode="errors", call="GET " + path, status=s, body=b[:200].decode(errors="replace"))
    s, h, b, ms = get("https://api.actnewdev.co.za/markets")
    out(mode="errors", call="GET https://api.actnewdev.co.za/markets, the server URL in the OpenAPI document", status=s, body=b[:200].decode(errors="replace"))


def mode_time() -> None:
    s, h, b, ms = get(API + "/markets")
    local = time.time()
    server = email.utils.parsedate_to_datetime(h.get("Date") or h.get("date")).timestamp()
    out(mode="time", date_header=h.get("Date") or h.get("date"), offset_s=round(server - local + ms / 2000, 2), rtt_ms=round(ms))


MODES = {"host": mode_host, "docs": mode_docs, "catalog": mode_catalog, "book": mode_book, "ticker": mode_ticker, "poll": mode_poll, "limits": mode_limits, "errors": mode_errors, "time": mode_time}

if __name__ == "__main__":
    out(probe="altcoin-trader rest", started_utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    for name in sys.argv[1:] or list(MODES):
        MODES[name]()
