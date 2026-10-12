# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for C-Patex, a spot venue on the X-TXC public API family.

Public, unauthenticated, read-only, one request at a time and about two a second at most.
The venue publishes no REST rate limit, so the probe stays far below any plausible one.
Standard library only.

Modes, each printing one JSON line per finding:
    latency   DNS and cold and warm timings of markets, tickers and depth/result, and the clock offset from the Date header.
    catalog   public/markets, public/tickers, public/products, public/symbols and the website's marketlist, cross-checked.
    depth     depth/result limits, level order, caching headers, public/book, and whether the book moves over ten seconds.
    errors    unknown and missing markets, out of range limits, unknown paths, a REST time path, an unsigned POST,
              and an upgrade request to back.c-patex.com/ws, the socket path the web bundle names.
    rate      ten sequential requests at one a second, with every rate limit header seen.
    all       every mode above in turn, about forty seconds.

Run from the repository root:
    uv run scripts/probes/venues/c-patex/rest-probe.py [latency|catalog|depth|errors|rate|all]

Recorded in docs/profiles/c-patex/rest.md.
"""

import collections
import email.utils
import json
import socket
import sys
import time
import urllib.error
import urllib.request

API_HOST = "api.c-patex.com"
API = f"https://{API_HOST}/api/v1/public"
BACK = "https://back.c-patex.com"
UA = {"User-Agent": "observatory-probe", "Accept": "application/json"}


def log(tag: str, **fields) -> None:
    print(json.dumps({"tag": tag, "at": round(time.time(), 3), **fields}, default=str), flush=True)


def fetch(url: str, body: dict | None = None) -> tuple[int, bytes, float, dict]:
    data = json.dumps(body).encode() if body is not None else None
    headers = {**UA, **({"Content-Type": "application/json"} if data else {})}
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data else "GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, raw, (time.perf_counter() - t0) * 1000, {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        return e.code, e.read(), (time.perf_counter() - t0) * 1000, {k.lower(): v for k, v in e.headers.items()}


def get_json(url: str):
    status, raw, ms, headers = fetch(url)
    try:
        return status, json.loads(raw), ms, headers, len(raw)
    except ValueError:
        return status, raw[:200].decode(errors="replace"), ms, headers, len(raw)


def latency() -> None:
    for host in (API_HOST, "back.c-patex.com", "ws.c-patex.com", "c-patex.com"):
        t0 = time.perf_counter()
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        log("dns", host=host, addrs=addrs, ms=round((time.perf_counter() - t0) * 1000, 1))
    for path in ("/markets", "/tickers", "/depth/result?market=BTC_USDT&limit=50"):
        times = []
        for _ in range(4):
            status, _, ms, headers = fetch(API + path)
            times.append(round(ms, 1))
            time.sleep(0.5)
        log("latency", path=path, status=status, cold_ms=times[0], warm_ms=times[1:], server=headers.get("server"),
            cf_ray=headers.get("cf-ray"), cf_cache=headers.get("cf-cache-status"))
    offsets = []
    for _ in range(3):
        before = time.time()
        _, _, _, headers = fetch(API + "/markets")
        after = time.time()
        served = email.utils.parsedate_to_datetime(headers["date"]).timestamp()
        offsets.append(round(served - (before + after) / 2, 2))
        time.sleep(0.5)
    log("clock_offset_from_date_header_s", offsets=offsets, note="Date has one second resolution")


def catalog() -> None:
    status, markets, ms, _, size = get_json(API + "/markets")
    rows = markets["result"]
    by_money = collections.Counter(r["money"] for r in rows)
    log("markets", status=status, ms=round(ms), bytes=size, count=len(rows), by_money=dict(by_money),
        keys=sorted(rows[0].keys()), sample=rows[0], names=sorted(r["name"] for r in rows))
    log("markets_precisions", moneyPrec=dict(collections.Counter(r["moneyPrec"] for r in rows)),
        stockPrec=dict(collections.Counter(r["stockPrec"] for r in rows)),
        minAmount=dict(collections.Counter(r["minAmount"] for r in rows)))
    derivative_like = [r["name"] for r in rows if any(t in r["name"].upper() for t in ("PERP", "SWAP", "-P", "FUT"))]
    log("markets_derivative_like_names", names=derivative_like)

    status, tickers, ms, _, size = get_json(API + "/tickers")
    t = tickers["result"]
    zero_vol = sorted(k for k, v in t.items() if float(v["ticker"]["vol"]) == 0)
    one_sided = sorted(k for k, v in t.items() if float(v["ticker"]["bid"]) == 0 or float(v["ticker"]["ask"]) == 0)
    crossed = sorted(k for k, v in t.items()
                     if float(v["ticker"]["bid"]) > 0 and float(v["ticker"]["ask"]) > 0
                     and float(v["ticker"]["bid"]) >= float(v["ticker"]["ask"]))
    ats = sorted({v["at"] for v in t.values()})
    log("tickers", status=status, ms=round(ms), bytes=size, count=len(t), zero_volume=zero_vol,
        zero_bid_or_ask=one_sided, crossed=crossed, at_values=ats[:3], at_lag_s=round(time.time() - ats[-1], 1),
        sample=t.get("BTC_USDT"))
    log("tickers_vs_markets", only_in_tickers=sorted(set(t) - {r["name"] for r in rows}),
        only_in_markets=sorted({r["name"] for r in rows} - set(t)))
    top = sorted(((float(v["ticker"]["deal"]), k) for k, v in t.items()), reverse=True)[:8]
    log("tickers_top_by_quote_volume", top=[[k, round(d)] for d, k in top])

    for path in ("/products", "/symbols"):
        status, body, ms, _, size = get_json(API + path)
        result = body.get("result") if isinstance(body, dict) else body
        log(path.strip("/"), status=status, bytes=size, count=len(result) if isinstance(result, list) else None,
            sample=result[:2] if isinstance(result, list) else str(body)[:200])

    status, ml, ms, _, size = get_json(BACK + "/marketlist")
    pairs = []

    def walk(node, trail):
        for p in node.get("pairs", []):
            pairs.append((trail, p["id"]))
        for sub in node.get("tabs", []):
            walk(sub, trail + [sub["id"]])

    for top_tab in ml["response"]:
        walk(top_tab, [top_tab["id"]])
    log("marketlist", status=status, bytes=size, top_tabs=[(x["label"], x["id"]) for x in ml["response"]],
        pairs=len(pairs), unique=len({p for _, p in pairs}), per_tab=dict(collections.Counter("/".join(t) for t, _ in pairs)))
    log("marketlist_vs_markets", only_in_marketlist=sorted({p for _, p in pairs} - {r["name"] for r in rows}),
        only_in_markets=sorted({r["name"] for r in rows} - {p for _, p in pairs}))


def depth() -> None:
    for limit in (1, 50, 100, 1000, 1001):
        status, body, ms, headers, size = get_json(f"{API}/depth/result?market=BTC_USDT&limit={limit}")
        if isinstance(body, dict) and "asks" in body:
            asks = [float(p) for p, _ in body["asks"]]
            bids = [float(p) for p, _ in body["bids"]]
            log("depth_result", limit=limit, status=status, ms=round(ms), bytes=size, asks=len(asks), bids=len(bids),
                asks_ascending=asks == sorted(asks), bids_ascending=bids == sorted(bids),
                best_ask=min(asks) if asks else None, best_bid=max(bids) if bids else None,
                first_bid=body["bids"][0] if bids else None, last_bid=body["bids"][-1] if bids else None,
                keys=sorted(body.keys()), cache_control=headers.get("cache-control"), cf_cache=headers.get("cf-cache-status"))
        else:
            log("depth_result", limit=limit, status=status, body=body if isinstance(body, str) else json.dumps(body)[:300])
        time.sleep(0.5)

    status, body, ms, _, size = get_json(f"{API}/depth/result?market=BTC_USDT")
    log("depth_result_default_limit", status=status, asks=len(body.get("asks", [])), bids=len(body.get("bids", [])))

    for side in ("sell", "buy"):
        status, body, ms, _, size = get_json(f"{API}/book?market=BTC_USDT&side={side}&offset=0&limit=5")
        result = body.get("result", {}) if isinstance(body, dict) else {}
        orders = result.get("orders", [])
        log("public_book", side=side, status=status, bytes=size, total=result.get("total"),
            prices=[o.get("price") for o in orders], sample=orders[:1], top_keys=sorted(body.keys()) if isinstance(body, dict) else None)
        time.sleep(0.5)

    snaps = []
    for _ in range(10):
        _, body, _, _, _ = get_json(f"{API}/depth/result?market=BTC_USDT&limit=20")
        snaps.append(json.dumps(body, sort_keys=True))
        time.sleep(1)
    log("depth_changes_over_10s", distinct_snapshots=len(set(snaps)), of=len(snaps))

    for market in ("ETH_USDT", "PATEX_USDT", "INCA_USDT"):
        status, body, _, _, _ = get_json(f"{API}/depth/result?market={market}&limit=100")
        log("depth_other_market", market=market, status=status, asks=len(body.get("asks", [])),
            bids=len(body.get("bids", [])))
        time.sleep(0.5)


def errors() -> None:
    cases = [
        ("unknown_market_depth", f"{API}/depth/result?market=NOPE_USDT&limit=5"),
        ("missing_market_depth", f"{API}/depth/result"),
        ("limit_zero", f"{API}/depth/result?market=BTC_USDT&limit=0"),
        ("unknown_market_ticker", f"{API}/ticker?market=NOPE_USDT"),
        ("ticker_btc", f"{API}/ticker?market=BTC_USDT"),
        ("book_missing_side", f"{API}/book?market=BTC_USDT"),
        ("unknown_public_path", f"{API}/nope"),
        ("time_path", f"{API}/time"),
        ("v2_time_path", "https://api.c-patex.com/api/v2/public/time"),
        ("private_path_get", "https://api.c-patex.com/api/v1/account/balance"),
    ]
    for name, url in cases:
        status, body, ms, headers, size = get_json(url)
        log("error_case", case=name, status=status, content_type=headers.get("content-type"),
            body=body if isinstance(body, str) else json.dumps(body)[:300])
        time.sleep(0.5)
    status, raw, ms, headers = fetch("https://api.c-patex.com/api/v1/account/balance",
                                     {"request": "/api/v1/account/balance", "nonce": str(int(time.time() * 1000))})
    log("error_case", case="unsigned_post_private", status=status, body=raw[:300].decode(errors="replace"))
    # The web bundle names wss://back.c-patex.com/ws. A plain upgrade request shows whether it is a socket at all.
    req = urllib.request.Request("https://back.c-patex.com/ws", headers={
        **UA, "Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            log("error_case", case="back_ws_upgrade", status=r.status, content_type=r.headers.get("content-type"),
                body=r.read(300).decode(errors="replace"))
    except urllib.error.HTTPError as e:
        log("error_case", case="back_ws_upgrade", status=e.code, body=e.read(300).decode(errors="replace"))


def rate() -> None:
    seen = collections.defaultdict(set)
    statuses = []
    for _ in range(10):
        status, _, ms, headers = fetch(API + "/tickers")
        statuses.append(status)
        for k, v in headers.items():
            if "rate" in k or "limit" in k or "retry" in k or k.startswith("x-"):
                seen[k].add(v)
        time.sleep(1)
    log("rate_headers", statuses=statuses, headers={k: sorted(v) for k, v in seen.items()})


MODES = {"latency": latency, "catalog": catalog, "depth": depth, "errors": errors, "rate": rate}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if mode in (name, "all"):
            log("mode", name=name)
            fn()
