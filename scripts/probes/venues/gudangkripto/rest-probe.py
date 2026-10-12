# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of GudangKripto's public REST surface.

Public, unauthenticated and read-only.
GudangKripto publishes no API documentation.
The paths below come from the endpoint map in the web app's entry chunk, which the rest profile cites.
Requests run one at a time with at least 0.5 s between them, except the six back-to-back timing requests in host mode.

Modes:
  host     DNS answer, cold and warm request time, response headers
  catalog  the coin list /api/core/coin, one coin detail, and the app's three other pair lists for comparison
  kline    the chart calls under /api/socket
  book     the candidate REST book paths, to show that none is served
  errors   an unknown coin, an unknown path, a bad kline query, and the GraphQL host named in the app config
  limits   20 requests at 2 per second, with every status and any rate limit header
  all      every mode above, in order
Run from the repository root with: uv run scripts/probes/venues/gudangkripto/rest-probe.py [mode]
"""

import json
import re
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

UA = {"User-Agent": "Mozilla/5.0 (survey probe)", "Accept": "application/json, */*"}
BACKEND = "https://be.gudangkripto.id"
SITE = "https://gudangkripto.id"


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch(url: str) -> tuple[int, dict, str, float]:
    t0 = time.perf_counter()
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            body = r.read().decode("utf-8", "replace")
            return r.status, dict(r.headers), body, (time.perf_counter() - t0) * 1000
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, dict(e.headers), body, (time.perf_counter() - t0) * 1000


def show(url: str, limit: int = 300) -> tuple[int, dict, str]:
    status, headers, body, ms = fetch(url)
    ctype = headers.get("Content-Type")
    print(f"GET {url}\n  HTTP {status} {ctype} {len(body)} bytes {ms:.0f} ms body {body[:limit]!r}")
    time.sleep(0.5)
    return status, headers, body


def mode_host() -> None:
    print(f"## host {now()}")
    for host in ["be.gudangkripto.id", "gudangkripto.id", "market.gudangkripto.id"]:
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        print(f"{host} resolves to {', '.join(addrs)}")
    url = f"{BACKEND}/api/core/app-parameter"
    times = []
    for i in range(6):
        status, headers, body, ms = fetch(url)
        times.append(ms)
        if i == 0:
            keep = {k: v for k, v in headers.items() if k.lower() in ("server", "cf-ray", "cf-cache-status", "date", "content-type", "access-control-allow-origin", "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after", "traceparent")}
            print(f"first request HTTP {status} headers {keep}")
            server_date = parsedate_to_datetime(headers["Date"])
            print(f"Date header {headers['Date']}, local clock {datetime.now(timezone.utc).isoformat(timespec='seconds')}, offset about {(datetime.now(timezone.utc) - server_date).total_seconds():.1f} s at 1 s resolution")
    print(f"request times ms: cold {times[0]:.0f}, warm {', '.join(f'{t:.0f}' for t in times[1:])}")
    print("each call opens a new TLS connection, so warm here means a warm DNS cache and a warm Cloudflare edge, not a reused socket")


def mode_catalog() -> None:
    print(f"## catalog {now()}")
    status, _, body, ms = fetch(f"{BACKEND}/api/core/coin")
    data = json.loads(body)["data"]
    print(f"/api/core/coin HTTP {status} {len(body)} bytes {ms:.0f} ms, {len(data)} coins")
    print(f"  fields: {', '.join(data[0].keys())}")
    pairs = sorted({f"{c['coin']}_{d['pairs']}" for c in data for d in c["detail"]})
    quotes = sorted({d["pairs"] for c in data for d in c["detail"]})
    print(f"  quote assets {quotes}, distinct coin and quote pairs {len(pairs)}: {', '.join(pairs)}")
    print(f"  rounded examples: {[(c['coin'], c['rounded']) for c in data if c['coin'] in ('BTC', 'USDT', 'ETH')]}")
    print(f"  min_buy and min_sell values (IDR): {sorted({(c['min_buy'], c['min_sell']) for c in data})}")
    print(f"  coins with volume_24h above 0: {sum(1 for c in data if c['volume_24h'])}")
    print(f"  no status, active, tick size or lot size field: {not any(k in data[0] for k in ('status', 'active', 'tick_size', 'lot_size', 'is_active'))}")
    time.sleep(0.5)
    status, _, body = show(f"{BACKEND}/api/core/coin/BTC", 200)
    d = json.loads(body)["data"]
    print(f"  BTC detail high_24h {d['high_24h']} low_24h {d['low_24h']} volume_24h {d['volume_24h']} rounded {d['rounded']}")
    status, _, body = show(f"{SITE}/api/core/crypto", 0)
    print(f"  the Nuxt server route /api/core/crypto returns {len(json.loads(body)['data'])} coins, the same list proxied")


def mode_kline() -> None:
    print(f"## kline {now()}")
    to = int(time.time())
    status, _, body = show(f"{BACKEND}/api/socket/kline/history/bulk?symbols=BTC_IDR&interval=1h&from={to - 6 * 3600}&to={to}", 600)
    try:
        d = json.loads(body)
        print(f"  top level keys {list(d) if isinstance(d, dict) else type(d).__name__}")
    except ValueError:
        pass
    show(f"{BACKEND}/api/socket/data-klines-tradingview", 200)
    show(f"{BACKEND}/api/socket/data-klines-tradingview?symbol=BTC_IDR&interval=1h&from={to - 3 * 3600}&to={to}", 400)


def mode_book() -> None:
    print(f"## book {now()}")
    for path in ["/api/market/orderbook?pair=BTC_IDR", "/api/market/orderbook/BTC_IDR", "/api/core/orderbook/BTC_IDR",
                 "/api/socket/orderbook/BTC_IDR", "/api/socket/depth?symbol=BTC_IDR", "/api/market/ticker", "/api/core/ticker",
                 "/api/v1/depth?symbol=BTC_IDR", "/api/v3/depth?symbol=BTC_IDR"]:
        show(BACKEND + path, 120)


def mode_errors() -> None:
    print(f"## errors {now()}")
    show(f"{BACKEND}/api/core/coin/NOPE", 200)
    show(f"{BACKEND}/api/core/does-not-exist", 200)
    show(f"{BACKEND}/", 200)
    show(f"{BACKEND}/api/core/static-pages/trading-rules", 200)
    host = "vakotrade-gudangkripto-uat.cryptosrvc.com"
    try:
        print(f"{host} resolves to {socket.getaddrinfo(host, 443)[0][4][0]}")
    except socket.gaierror as e:
        print(f"{host} does not resolve: {e}")


def mode_limits() -> None:
    print(f"## limits {now()}")
    url = f"{BACKEND}/api/core/app-parameter"
    statuses = []
    for i in range(20):
        status, headers, _, ms = fetch(url)
        rl = {k: v for k, v in headers.items() if re.search(r"rate|limit|retry", k, re.I)}
        statuses.append(status)
        if rl or status != 200:
            print(f"  request {i + 1} HTTP {status} {ms:.0f} ms limit headers {rl}")
        time.sleep(0.5)
    print(f"20 requests at 2 per second: statuses {sorted(set(statuses))}, count of 200 {statuses.count(200)}")


MODES = {"host": mode_host, "catalog": mode_catalog, "kline": mode_kline, "book": mode_book, "errors": mode_errors, "limits": mode_limits}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if mode in (name, "all"):
            fn()
