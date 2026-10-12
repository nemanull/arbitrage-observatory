# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""BlueBit public REST probe for docs/profiles/bluebit/rest.md.

Covers the spot open API at openapi.bluebit.io, the futures hosts the website names, and the website config.
Read-only and unauthenticated, about 60 requests at one per second, inside the published 6 requests per 2 s.
Run from the repository root with: uv run scripts/probes/venues/bluebit/rest-probe.py
"""

import email.utils
import http.client
import json
import socket
import ssl
import statistics
import time

OPEN = "openapi.bluebit.io"  # root URL in the API doc
WEB = "www.bluebit.io"
FUT_SITE = "futures.bluebit.io"  # coUrl in fePublicInfo
FUT_API = "futuresopenapi.bluebit.io"  # ChainUP futures open API host name pattern
CTX = ssl.create_default_context()
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}


def request(host: str, path: str, method: str = "GET", body: bytes | None = None, conn=None):
    """One request. Returns status, headers, text, seconds, and the connection for reuse."""
    own = conn is None
    if own:
        conn = http.client.HTTPSConnection(host, 443, timeout=20, context=CTX)
    headers = dict(UA)
    if body is not None:
        headers["Content-Type"] = "application/json"
    t0 = time.perf_counter()
    conn.request(method, path, body=body, headers=headers)
    resp = conn.getresponse()
    text = resp.read().decode("utf-8", "replace")
    dt = time.perf_counter() - t0
    hdrs = {k.lower(): v for k, v in resp.getheaders()}
    if own or hdrs.get("connection", "").lower() == "close":
        conn.close()
        conn = None
    time.sleep(1.0)
    return resp.status, hdrs, text, dt, conn


def as_json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def short(text: str, n: int = 220) -> str:
    if "<title>" in text:
        return "HTML, title " + repr(text[text.find("<title>") + 7:text.find("</title>")])
    return text[:n].replace("\n", " ") + (f"... ({len(text)} chars)" if len(text) > n else "")


def section_hosts():
    print("== 1. hosts and latency")
    for host in (WEB, OPEN, "ws.bluebit.io", FUT_SITE, FUT_API, "api.bluebit.io", "fapi.bluebit.io"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as err:
            addrs = [f"no address ({err.strerror})"]
        print(f"  {host}: {addrs}")
    cold = []
    for _ in range(3):
        status, hdrs, text, dt, _ = request(OPEN, "/open/api/get_ticker?symbol=btcusdt")
        cold.append(dt * 1000)
    print(f"  cold get_ticker (new TLS connection each) ms: {[round(x) for x in cold]}, server {hdrs.get('server')!r}, connection {hdrs.get('connection')!r}")
    conn = http.client.HTTPSConnection(OPEN, 443, timeout=20, context=CTX)
    warm = []
    reused = 0
    for _ in range(5):
        status, hdrs, text, dt, conn2 = request(OPEN, "/open/api/get_ticker?symbol=btcusdt", conn=conn)
        warm.append(dt * 1000)
        reused += conn2 is not None
        conn = conn2 or http.client.HTTPSConnection(OPEN, 443, timeout=20, context=CTX)
    print(f"  second set ms: {[round(x) for x in warm]}, connection kept open after {reused} of 5 replies")


def section_catalog():
    print("\n== 2. catalog")
    status, hdrs, text, dt, _ = request(OPEN, "/open/api/common/symbols")
    data = as_json(text)
    syms = data["data"] if data else []
    print(f"  /open/api/common/symbols: status {status}, code {data and data.get('code')}, {len(syms)} symbols, {len(text)} bytes, {dt * 1000:.0f} ms")
    quotes = {}
    for s in syms:
        quotes[s["count_coin"]] = quotes.get(s["count_coin"], 0) + 1
    print(f"  by quote: {quotes}")
    print(f"  fields: {sorted(syms[0]) if syms else None}")
    print(f"  first: {syms[0] if syms else None}")
    print(f"  symbol spelling all lowercase base+quote: {all(s['symbol'] == (s['base_coin'] + s['count_coin']).lower() for s in syms)}")
    status, hdrs, text2, dt, _ = request(OPEN, "/exchange-open-api/open/api/common/symbols")
    print(f"  /exchange-open-api/open/api/common/symbols (open_api_url of the web config): status {status}, same body as the bare path: {text2 == text}")
    status, hdrs, text, dt, _ = request(WEB, "/fePublicInfo")
    info = json.loads(text[text.index("=") + 1:].rstrip().rstrip(";"))
    live = sorted(d["symbol"] for q in info["market"]["market"].values() for d in q.values())
    print(f"  website market list (fePublicInfo market.market): {len(live)} symbols, same set as common/symbols: {set(live) == {s['symbol'] for s in syms}}")
    print(f"  futures_type {info.get('futures_type')!r}, coUrl {info['url'].get('coUrl')!r}, wsUrl {info['market'].get('wsUrl')!r}")
    status, hdrs, text, dt, _ = request(WEB, "/fe-ex-api/common/public_info", "POST", b"{}")
    d = (as_json(text) or {}).get("data", {})
    print(f"  /fe-ex-api/common/public_info: status {status}, contractOpen {d.get('contractOpen')!r}, exOpen {d.get('exOpen')!r}")
    return [s["symbol"] for s in syms]


def section_futures():
    print("\n== 3. futures and anchor surfaces")
    calls = [
        (FUT_API, "/fapi/v1/contracts", "GET", None),
        (FUT_API, "/fapi/v1/ticker?contractName=E-BTC-USDT", "GET", None),
        (FUT_API, "/fapi/v1/index?contractName=E-BTC-USDT", "GET", None),
        (FUT_SITE, "/fe-co-api/common/public_info", "POST", b"{}"),
        (FUT_SITE, "/fe-co-api/common/public_market_info", "POST", b"{}"),
        (FUT_SITE, "/fe-co-api/common/getMakerAndTaker", "GET", None),
        (FUT_SITE, "/en_US/", "GET", None),
    ]
    for host, path, method, body in calls:
        try:
            status, hdrs, text, dt, _ = request(host, path, method, body)
            print(f"  {method} https://{host}{path}: {status}, {len(text)} bytes, {dt * 1000:.0f} ms, {short(text, 120)}")
        except OSError as err:
            print(f"  {method} https://{host}{path}: {type(err).__name__} {err}")
    status, hdrs, text, dt, _ = request(OPEN, "/open/api/market")
    data = as_json(text)
    print(f"  /open/api/market (last price per symbol): status {status}, {len(data['data']) if data else 0} symbols, {len(text)} bytes, {dt * 1000:.0f} ms")


def section_tickers(symbols):
    print("\n== 3b. bulk ticker")
    status, hdrs, text, dt, _ = request(OPEN, "/open/api/get_allticker")
    data = as_json(text)
    tick = data["data"]["ticker"] if data else []
    print(f"  /open/api/get_allticker: status {status}, {len(tick)} rows, {len(text)} bytes, {dt * 1000:.0f} ms, fields {sorted(tick[0]) if tick else None}")
    for row in tick:
        if row["symbol"] in ("btcusdt", "ethusdt", "usdcusdt", "tonusdt"):
            b, a = float(row.get("buy") or 0), float(row.get("sell") or 0)
            spread = (a - b) / ((a + b) / 2) * 1e6 if a and b else None
            print(f"    {row['symbol']}: buy {row.get('buy')} sell {row.get('sell')} last {row.get('last')} vol {row.get('vol')}, spread ppm {spread and round(spread)}")
    missing = [r["symbol"] for r in tick if not r.get("buy") or not r.get("sell")]
    print(f"  rows without buy or sell: {missing}")


def section_book():
    print("\n== 5. REST book")
    for path in (
        "/open/api/market_dept?symbol=btcusdt&type=step0",
        "/open/api/market_dept?symbol=BTCUSDT&type=step0",
        "/open/api/market_dept?symbol=ETHUSDT&type=step1",
        "/open/api/market_dept?symbol=btcusdt",
    ):
        status, hdrs, text, dt, _ = request(OPEN, path)
        print(f"  {path}: {status}, {short(text, 160)}")
    status, hdrs, text, dt, _ = request(OPEN, "/open/api/get_trades?symbol=btcusdt")
    data = as_json(text)
    rows = data["data"] if data else []
    ts = [r["ctime"] for r in rows]
    sides = {}
    for r in rows:
        sides[r["type"]] = sides.get(r["type"], 0) + 1
    gaps = [(a - b) / 1000 for a, b in zip(ts, ts[1:])]
    print(f"  get_trades btcusdt: {len(rows)} trades, sides {sides}, median gap {statistics.median(gaps) if gaps else None} s, sizes {sorted({r['amount'] for r in rows})[:5]}")


def section_errors():
    print("\n== 6. errors and limits")
    for path in ("/open/api/get_ticker?symbol=BTCUSDT", "/open/api/get_ticker?symbol=nosuchusdt", "/open/api/get_ticker", "/open/api/nosuch", "/sapi/v1/symbols"):
        status, hdrs, text, dt, _ = request(OPEN, path)
        print(f"  {path}: {status}, {short(text, 160)}")
    print(f"  limit headers on the last reply: {[k for k in hdrs if 'limit' in k or 'retry' in k]}")


def section_time():
    print("\n== 7. server time")
    for path in ("/open/api/common/timestamp", "/sapi/v1/time"):
        status, hdrs, text, dt, _ = request(OPEN, path)
        print(f"  {path}: {status}, {short(text, 120)}")
    offsets = []
    for _ in range(5):
        t0 = time.time()
        status, hdrs, text, dt, _ = request(OPEN, "/open/api/get_allticker")
        mid = t0 + dt / 2
        server_ms = (as_json(text) or {}).get("data", {}).get("date")
        if server_ms:
            offsets.append(server_ms / 1000 - mid)
        date_hdr = email.utils.parsedate_to_datetime(hdrs["date"]).timestamp()
    print(f"  get_allticker data.date minus local midpoint, ms: {[round(o * 1000) for o in offsets]}")
    print(f"  last Date header minus local midpoint, s: {date_hdr - mid:.1f} (one second resolution)")


def section_cadence():
    print("\n== 4. ticker change cadence, 20 polls at about 1 s")
    seen = []
    for _ in range(20):
        status, hdrs, text, dt, _ = request(OPEN, "/open/api/get_ticker?symbol=btcusdt")
        d = (as_json(text) or {}).get("data") or {}
        seen.append((d.get("time"), d.get("last"), d.get("buy"), d.get("sell")))
    times = [s[0] for s in seen]
    changes_last = sum(1 for a, b in zip(seen, seen[1:]) if a[1] != b[1])
    changes_top = sum(1 for a, b in zip(seen, seen[1:]) if a[2:] != b[2:])
    print(f"  distinct time values {len(set(times))} of 20, last changed {changes_last} times, buy or sell changed {changes_top} times")


def main():
    section_hosts()
    symbols = section_catalog()
    section_futures()
    section_tickers(symbols)
    section_cadence()
    section_book()
    section_errors()
    section_time()


if __name__ == "__main__":
    main()
