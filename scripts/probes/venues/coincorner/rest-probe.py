# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of CoinCorner's public REST surface at api.coincorner.com.

Modes:
  host     resolve the host, time a cold and a warm request, print edge headers
  paths    call the documented Ticker and the undocumented OrderBook for several pairs, plus wrong paths
  poll     poll Ticker and OrderBook for BTC/GBP every 5 s for about 60 s, 24 requests in all
  all      every mode above, in order

The published limit is 60 requests a minute, and no mode comes near it.
"""

import http.client
import json
import socket
import ssl
import sys
import time
from datetime import datetime, timezone

HOST = "api.coincorner.com"
UA = {"User-Agent": "Mozilla/5.0 (survey probe)", "Accept": "application/json"}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")[:-4] + "Z"


def get(conn: http.client.HTTPSConnection, path: str) -> tuple[int, dict, bytes, float]:
    t0 = time.perf_counter()
    conn.request("GET", path, headers=UA)
    r = conn.getresponse()
    body = r.read()
    ms = (time.perf_counter() - t0) * 1000
    return r.status, {k.lower(): v for k, v in r.getheaders()}, body, ms


def new_conn() -> http.client.HTTPSConnection:
    return http.client.HTTPSConnection(HOST, 443, timeout=15, context=ssl.create_default_context())


def mode_host() -> None:
    print(f"## host {now()}")
    addrs = sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443)})
    print("resolved", addrs)
    conn = new_conn()
    t0 = time.perf_counter()
    conn.connect()
    print(f"tcp+tls connect {1000 * (time.perf_counter() - t0):.0f} ms")
    path = "/api/Ticker?Coin=BTC&Currency=GBP"
    for label in ("first request on the open connection", "warm 1", "warm 2", "warm 3"):
        status, h, body, ms = get(conn, path)
        print(f"{label}: HTTP {status} {ms:.0f} ms {len(body)} bytes")
    for k in ("server", "cf-ray", "cf-cache-status", "cache-control", "date", "x-ratelimit-limit", "x-ratelimit-remaining", "retry-after"):
        print(f"  {k}: {h.get(k)}")
    conn.close()
    cold = new_conn()
    t0 = time.perf_counter()
    status, _, body, _ = get(cold, path)
    print(f"cold request including connect: HTTP {status} {1000 * (time.perf_counter() - t0):.0f} ms")
    server_date = h.get("date")
    if server_date:
        sd = datetime.strptime(server_date, "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
        print(f"server Date header {server_date}, local clock minus Date {(datetime.now(timezone.utc) - sd).total_seconds():.1f} s (1 s resolution)")
    cold.close()


def show(conn: http.client.HTTPSConnection, path: str, limit: int = 700) -> bytes:
    status, h, body, ms = get(conn, path)
    text = body.decode("utf-8", "replace")
    print(f"GET {path} HTTP {status} {ms:.0f} ms {h.get('content-type')} {len(body)} bytes")
    print("  " + text[:limit].replace("\n", " "))
    return body


def mode_paths() -> None:
    print(f"## paths {now()}")
    conn = new_conn()
    tickers = {}
    books = {}
    for coin, cur in (("BTC", "GBP"), ("BTC", "EUR"), ("BTC", "USD"), ("ETH", "GBP"), ("LTC", "EUR"), ("USDT", "GBP"), ("XYZ", "GBP")):
        q = f"Coin={coin}&Currency={cur}"
        tickers[q] = show(conn, f"/api/Ticker?{q}")
        books[q] = show(conn, f"/api/OrderBook?{q}", 1200)
        time.sleep(1.2)
    t_base = json.loads(tickers["Coin=BTC&Currency=GBP"])
    for q, b in tickers.items():
        d = json.loads(b)
        same = all(d.get(k) == t_base.get(k) for k in ("LastPrice", "AvgPrice", "Volume"))
        print(f"ticker {q}: LastPrice {d.get('LastPrice')} AvgPrice {d.get('AvgPrice')} Volume {d.get('Volume')} same as BTC/GBP: {same}")
    b_base = json.loads(books["Coin=BTC&Currency=GBP"])
    for q, b in books.items():
        d = json.loads(b)
        same = d.get("buys") == b_base.get("buys") and d.get("sells") == b_base.get("sells")
        drift = max(abs(x["Price"] / y["Price"] - 1) for side in ("buys", "sells") for x, y in zip(d[side], b_base[side]))
        amounts = sorted({x["Amount"] for side in ("buys", "sells") for x in d[side]})
        print(f"book {q}: Coin {d.get('Coin')} buys {len(d.get('buys', []))} sells {len(d.get('sells', []))} identical to BTC/GBP: {same}, largest price gap to the BTC/GBP reply {drift * 1e6:.0f} ppm, amounts {amounts}")
    d = b_base
    print("BTC/GBP buys, in wire order:", [(x["Price"], x["Amount"]) for x in d["buys"]])
    print("BTC/GBP sells, in wire order:", [(x["Price"], x["Amount"]) for x in d["sells"]])
    bid, ask, last = d["buys"][0]["Price"], d["sells"][0]["Price"], t_base["LastPrice"]
    mid = (bid + ask) / 2
    print(f"first level: bid {bid} ask {ask}, spread {1e6 * (ask - bid) / mid:.0f} ppm of mid, ask {1e6 * (ask / last - 1):.0f} ppm above LastPrice {last}, bid {1e6 * (1 - bid / last):.0f} ppm below it")
    print("each level's price as a fraction of the first:", [round(x["Price"] / bid, 6) for x in d["buys"]], [round(x["Price"] / ask, 6) for x in d["sells"]])
    for p in ("/api/Ticker", "/api/OrderBook", "/api/Trades?Coin=BTC&Currency=GBP", "/api/Markets", "/api/Currencies", "/api/Time", "/Help", "/Help/Api/GET-api-Ticker_Coin_Currency", "/Help/Api/GET-api-OrderBook_Coin_Currency"):
        show(conn, p, 160)
        time.sleep(1.2)
    conn.close()


def mode_poll() -> None:
    print(f"## poll {now()}")
    conn = new_conn()
    seen_t = []
    seen_b = []
    for i in range(12):
        _, _, tb, tms = get(conn, "/api/Ticker?Coin=BTC&Currency=GBP")
        _, _, bb, bms = get(conn, "/api/OrderBook?Coin=BTC&Currency=GBP")
        t = json.loads(tb)
        b = json.loads(bb)
        top = (b["buys"][0]["Price"], b["sells"][0]["Price"]) if b.get("buys") and b.get("sells") else None
        print(f"{now()} ticker {tms:.0f} ms LastPrice {t['LastPrice']} AvgPrice {t['AvgPrice']} Volume {t['Volume']} CreateDate {t['CreateDate']} book {bms:.0f} ms top {top}")
        seen_t.append((t["LastPrice"], t["AvgPrice"], t["Volume"]))
        seen_b.append(bb)
        time.sleep(5)
    print(f"distinct ticker (LastPrice, AvgPrice, Volume) values: {len(set(seen_t))} of {len(seen_t)}")
    print(f"distinct order book bodies: {len(set(seen_b))} of {len(seen_b)}")
    conn.close()


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    modes = {"host": mode_host, "paths": mode_paths, "poll": mode_poll}
    for name in (modes if mode == "all" else [mode]):
        modes[name]()


if __name__ == "__main__":
    main()
