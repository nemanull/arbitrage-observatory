# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of Bittylicious's public REST surface on bittylicious.com.

Modes:
  host     resolve the host, time a cold and a warm request, print edge headers and the Date offset
  ticker   read /api/v1/ticker, the one catalog-like call, and summarise its pairs and caching
  quote    call the quote paths the buy page uses, for several coins, sides and amounts, plus error cases
  paths    try order book, depth, market, time and status paths that a venue API would usually have
  poll     poll the BTC buy and sell quote every 5 s for about 60 s, 26 requests in all
  all      every mode above, in order

No rate limit is published, because the help wiki that would hold it answers HTTP 500.
No mode sends more than one request a second.
"""

import http.client
import json
import socket
import ssl
import sys
import time
from datetime import datetime, timezone

HOST = "bittylicious.com"
UA = {"User-Agent": "Mozilla/5.0 (survey probe)", "Accept": "application/json"}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def new_conn() -> http.client.HTTPSConnection:
    return http.client.HTTPSConnection(HOST, 443, timeout=20, context=ssl.create_default_context())


def get(conn: http.client.HTTPSConnection, path: str) -> tuple[int, dict, bytes, float]:
    t0 = time.perf_counter()
    conn.request("GET", path, headers=UA)
    r = conn.getresponse()
    body = r.read()
    return r.status, {k.lower(): v for k, v in r.getheaders()}, body, (time.perf_counter() - t0) * 1000


def mode_host() -> None:
    print(f"## host {now()}")
    print("resolved", sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443)}))
    conn = new_conn()
    t0 = time.perf_counter()
    conn.connect()
    print(f"tcp+tls connect {1000 * (time.perf_counter() - t0):.0f} ms")
    path = "/api/v1/quote/BTC/GB/GBP/BANK/1/BUY"
    h = {}
    for label in ("first request on the open connection", "warm 1", "warm 2", "warm 3"):
        status, h, body, ms = get(conn, path)
        print(f"{label}: HTTP {status} {ms:.0f} ms {len(body)} bytes")
    for k in ("server", "cf-ray", "cf-cache-status", "cache-control", "content-type", "access-control-allow-origin", "x-ratelimit-limit", "retry-after"):
        print(f"  {k}: {h.get(k)}")
    conn.close()
    cold = new_conn()
    t0 = time.perf_counter()
    status, h2, _, _ = get(cold, path)
    print(f"cold request including connect: HTTP {status} {1000 * (time.perf_counter() - t0):.0f} ms")
    sd = datetime.strptime(h2["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
    print(f"server Date header {h2['date']}, local clock minus Date {(datetime.now(timezone.utc) - sd).total_seconds():.1f} s (1 s resolution)")
    cold.close()


def mode_ticker() -> None:
    print(f"## ticker {now()}")
    conn = new_conn()
    for attempt in (1, 2):
        status, h, body, ms = get(conn, "/api/v1/ticker")
        print(f"GET /api/v1/ticker try {attempt}: HTTP {status} {ms:.0f} ms {len(body)} bytes, "
              f"cache-control {h.get('cache-control')}, cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, last-modified {h.get('last-modified')}")
    d = json.loads(body)
    print(f"{len(d)} keys, fiat-first concatenation such as GBPBTC")
    quotes = sorted({k[:3] for k in d})
    print(f"fiat prefixes {quotes}")
    live = {k: v for k, v in d.items() if v["rates"]["last"] is not None}
    traded = {k: v for k, v in d.items() if v["volume_24h"]}
    print(f"{len(live)} keys with a non-null last, {len(traded)} with a non-zero volume_24h")
    for k, v in live.items():
        print(f"  {k}: {json.dumps(v)}")
    print(f"sample null row: {json.dumps(d['USDBTC'])}")
    conn.close()


QUOTES = [
    "/api/v1/quote/BTC/GB/GBP/BANK/1/BUY",
    "/api/v1/quote/BTC/GB/GBP/BANK/1/SELL",
    "/api/v1/quote/BTC/GB/GBP/BANK/1",
    "/api/v1/quote/LTC/GB/GBP/BANK/10/BUY",
    "/api/v1/quote/DOGE/GB/GBP/BANK/1000/BUY",
    "/api/v1/quote/ETH/GB/GBP/BANK/1/BUY",
    "/api/v1/quote/ETH/GB/GBP/BANK/1/SELL",
    "/api/v1/quote/BTC/GB/GBP/CARD/0.01/BUY?routes[]=AXCESS&routes[]=TRUSTPAY",
    "/api/v1/quote/BTC/EU/EUR/CARD/0.01/BUY?routes[]=AXCESS&routes[]=TRUSTPAY",
    "/api/v1/quote/BTC/EU/EUR/SEPA/0.01/BUY",
    "/api/v1/quoteFiat/BTC/GB/GBP/BANK/100/BUY",
    "/api/v1/quote/BTC/GB/GBP/BANK/100/BUY",
    "/api/v1/quote/BTC/GB/GBP/BANK/0.0001/BUY",
    "/api/v1/quote/XYZ/GB/GBP/BANK/1/BUY",
    "/api/v1/quote/BTC/GB/GBP/BANK/abc/BUY",
]


def mode_quote() -> None:
    print(f"## quote {now()}")
    conn = new_conn()
    for path in QUOTES:
        status, h, body, ms = get(conn, path)
        print(f"GET {path}: HTTP {status} {ms:.0f} ms cf-cache-status {h.get('cf-cache-status')}")
        print("  " + body.decode("utf-8", "replace")[:240].replace("\n", " "))
        time.sleep(1)
    conn.close()


PATHS = [
    "/api/v1/orderbook/BTCGBP",
    "/api/v1/orderBook/BTC/GBP",
    "/api/v1/depth/BTCGBP",
    "/api/v1/markets",
    "/api/v1/symbols",
    "/api/v1/time",
    "/api/v1/status",
    "/api/v1/currencies",
    "/api/v1/prices",
    "/api/v2/ticker",
    "/api/v1/",
    "/api/",
]


def mode_paths() -> None:
    print(f"## paths {now()}")
    conn = new_conn()
    for path in PATHS:
        status, h, body, ms = get(conn, path)
        text = body.decode("utf-8", "replace")
        title = text[text.find("<title>") + 7:text.find("</title>")] if "<title>" in text else text[:120]
        print(f"GET {path}: HTTP {status} {h.get('content-type')} {len(body)} bytes, {title.strip()}")
        time.sleep(1)
    conn.close()


def mode_poll() -> None:
    print(f"## poll {now()}")
    conn = new_conn()
    last = {}
    changes = {"BUY": 0, "SELL": 0}
    for i in range(13):
        row = []
        for side in ("BUY", "SELL"):
            _, _, body, ms = get(conn, f"/api/v1/quote/BTC/GB/GBP/BANK/1/{side}")
            price = json.loads(body).get("totalPrice")
            if side in last and price != last[side]:
                changes[side] += 1
            last[side] = price
            row.append(f"{side} {price} ({ms:.0f} ms)")
        print(f"{now()} " + ", ".join(row))
        if i < 12:
            time.sleep(5)
    print(f"changes over 12 intervals: {changes}")
    conn.close()


MODES = {"host": mode_host, "ticker": mode_ticker, "quote": mode_quote, "paths": mode_paths, "poll": mode_poll}

if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name in MODES if arg == "all" else [arg]:
        MODES[name]()
