# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only public REST probe for Ndax, the AlphaPoint gateway at https://api.ndax.io:8443/AP.

Modes, all by default, or name some on the command line:
    host     the exit IP and its geolocation, DNS for api.ndax.io, TCP and TLS time, and four cold Ping calls.
    catalog  GetInstruments and GetProducts: counts by type, status, quote and disabled flag, and any pair listed twice.
    anchor   paths an index, mark or funding call would use, to show they do not exist.
    book     GetL2Snapshot on BTCCAD at Depth 5, 20, 100 and 500, plus a thin pair, the CoinMarketCap style orderbook, summary and ticker calls, and GetLevel1, with level order, repeated prices, size and time.
    errors   unknown instrument, missing parameters, a symbol instead of an id, a private call, and an unknown path.
    poll     GetL2Snapshot on BTCCAD at Depth 20, one call every 1.2 s for 60 s, counting top of book changes, MDUpdateId changes, reply times and any rate limit header.
    time     the HTTP Date header and the ActionDateTime of a snapshot against the local clock.

The poll mode makes about 50 calls in 60 s, under one call a second, which is CCXT's rateLimit of 1000 ms.
The flag --short halves the poll window for the second pass rerun.

Run from the repository root:
    uv run scripts/probes/venues/ndax/rest-probe.py [--short] [mode ...]
"""

import json
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request

BASE = "https://api.ndax.io:8443/AP"
HOST = "api.ndax.io"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
POLL_S = 60 * (0.5 if "--short" in sys.argv else 1.0)


def out(**kw) -> None:
    print(json.dumps(kw, ensure_ascii=False, default=str), flush=True)


def get(path: str, timeout: float = 20.0) -> dict:
    url = path if path.startswith("http") else f"{BASE}/{path}"
    req = urllib.request.Request(url, headers=UA)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            status, headers = r.status, dict(r.headers.items())
    except urllib.error.HTTPError as e:
        body, status, headers = e.read(), e.code, dict(e.headers.items())
    t1 = time.time()
    text = body.decode("utf-8", "replace")
    try:
        data = json.loads(text)
    except ValueError:
        data = None
    return {"url": url, "status": status, "ms": round((t1 - t0) * 1000, 1), "bytes": len(body),
            "headers": headers, "text": text, "json": data, "t0": t0, "t1": t1}


def trim(s: str, n: int = 400) -> str:
    return s if len(s) <= n else s[:n] + f"...(+{len(s) - n} chars)"


def limit_headers(h: dict) -> dict:
    return {k: v for k, v in h.items() if any(x in k.lower() for x in ("limit", "retry", "cache", "cf-ray", "age"))}


def mode_host() -> None:
    r = get("https://ipinfo.io/json")
    j = r["json"] or {}
    out(mode="host", exit_ip=j.get("ip"), city=j.get("city"), region=j.get("region"), country=j.get("country"), org=j.get("org"))
    addrs = sorted({ai[4][0] for ai in socket.getaddrinfo(HOST, 8443, proto=socket.IPPROTO_TCP)})
    out(mode="host", dns=addrs)
    v4 = [a for a in addrs if ":" not in a][0]
    t0 = time.time()
    s = socket.create_connection((v4, 8443), timeout=10)
    t1 = time.time()
    ctx = ssl.create_default_context()
    ss = ctx.wrap_socket(s, server_hostname=HOST)
    t2 = time.time()
    out(mode="host", addr=v4, tcp_ms=round((t1 - t0) * 1000, 1), tls_ms=round((t2 - t1) * 1000, 1), tls=ss.version())
    ss.close()
    for _ in range(4):
        r = get("Ping")
        out(mode="host", call="Ping", status=r["status"], ms=r["ms"], body=r["text"], server=r["headers"].get("Server"),
            cf_ray=r["headers"].get("CF-RAY") or r["headers"].get("cf-ray"))
        time.sleep(1.2)


def mode_catalog() -> None:
    r = get("GetInstruments?OMSId=1")
    inst = r["json"]
    count = lambda key: dict(sorted({str(x.get(key)): sum(1 for y in inst if str(y.get(key)) == str(x.get(key))) for x in inst}.items()))
    out(mode="catalog", call="GetInstruments", status=r["status"], ms=r["ms"], bytes=r["bytes"], instruments=len(inst),
        by_type=count("InstrumentType"), by_session=count("SessionStatus"), by_disabled=count("IsDisable"), by_quote=count("Product2Symbol"))
    pairs = {}
    for x in inst:
        pairs.setdefault((x["Product1Symbol"], x["Product2Symbol"]), []).append(f'{x["InstrumentId"]}:{x["Symbol"]}')
    out(mode="catalog", pairs_listed_twice={f"{b}/{q}": ids for (b, q), ids in pairs.items() if len(ids) > 1})
    out(mode="catalog", symbol_differs_from_venue_symbol=[x["Symbol"] for x in inst if x["Symbol"] != x["VenueSymbol"]])
    out(mode="catalog", non_cad=[f'{x["InstrumentId"]}:{x["Symbol"]}' for x in inst if x["Product2Symbol"] != "CAD"])
    out(mode="catalog", first_ids=[f'{x["InstrumentId"]}:{x["Symbol"]}' for x in inst[:6]])
    out(mode="catalog", sample=trim(json.dumps(inst[0]), 1400))
    time.sleep(1.2)
    r = get("GetProducts?OMSId=1")
    prods = r["json"]
    types = {}
    for p in prods:
        types[p.get("ProductType")] = types.get(p.get("ProductType"), 0) + 1
    out(mode="catalog", call="GetProducts", status=r["status"], bytes=r["bytes"], products=len(prods), by_type=types,
        margin_enabled=sum(1 for p in prods if p.get("MarginEnabled")), disabled=sum(1 for p in prods if p.get("IsDisabled")))


def mode_anchor() -> None:
    for p in ["GetIndexPrice?OMSId=1&InstrumentId=1", "GetMarkPrice?OMSId=1&InstrumentId=1", "GetFundingRate?OMSId=1&InstrumentId=1",
              "GetInstrumentsWithFunding?OMSId=1", "GetPerpetualInstruments?OMSId=1"]:
        r = get(p)
        out(mode="anchor", path=p, status=r["status"], ctype=r["headers"].get("Content-Type"), body=trim(r["text"], 200))
        time.sleep(1.2)


def book_stats(rows: list) -> dict:
    bids = [x for x in rows if x[9] == 0]
    asks = [x for x in rows if x[9] == 1]
    bp, ap = [x[6] for x in bids], [x[6] for x in asks]
    return {"rows": len(rows), "bids": len(bids), "asks": len(asks),
            "bids_desc": bp == sorted(bp, reverse=True), "asks_asc": ap == sorted(ap),
            "best_bid": bp[0] if bp else None, "best_ask": ap[0] if ap else None,
            "crossed": bool(bp and ap and max(bp) >= min(ap)),
            "repeated_bid_prices": len(bp) - len(set(bp)), "repeated_ask_prices": len(ap) - len(set(ap)),
            "md_update_ids": sorted({x[0] for x in rows})[:3], "action_types": sorted({x[3] for x in rows}),
            "instrument_field7": sorted({x[7] for x in rows}), "order_count_field5": sorted({x[5] for x in rows})[:6], "order_count_max": max((x[5] for x in rows), default=None), "bids_first": [x[9] for x in rows] == sorted(x[9] for x in rows),
            "field1": sorted({x[1] for x in rows})[:6], "zero_qty": sum(1 for x in rows if not x[8]),
            "ts_min": min(x[2] for x in rows) if rows else None, "ts_max": max(x[2] for x in rows) if rows else None}


def mode_book() -> None:
    for depth in (5, 20, 100, 500):
        r = get(f"GetL2Snapshot?OMSId=1&InstrumentId=1&Depth={depth}")
        out(mode="book", instrument=1, depth=depth, status=r["status"], ms=r["ms"], bytes=r["bytes"],
            cache=limit_headers(r["headers"]), **book_stats(r["json"]))
        if depth == 5:
            out(mode="book", excerpt=trim(r["text"], 900))
        time.sleep(1.2)
    r = get("GetInstruments?OMSId=1")
    thin = [x for x in r["json"] if x["Product2Symbol"] == "CAD"][-1]
    time.sleep(1.2)
    r = get(f"GetL2Snapshot?OMSId=1&InstrumentId={thin['InstrumentId']}&Depth=100")
    out(mode="book", instrument=thin["InstrumentId"], symbol=thin["Symbol"], depth=100, status=r["status"], bytes=r["bytes"], **book_stats(r["json"]))
    time.sleep(1.2)
    r = get("orderbook?market_pair=BTC_CAD&depth=100")
    j = r["json"] or {}
    out(mode="book", call="orderbook BTC_CAD depth 100", status=r["status"], bytes=r["bytes"], bids=len(j.get("bids", [])), asks=len(j.get("asks", [])),
        excerpt=trim(r["text"], 300))
    time.sleep(1.2)
    r = get("orderbook?market_pair=BTC_CAD&depth=100&level=2")
    j = r["json"] or {}
    out(mode="book", call="orderbook BTC_CAD depth 100 level 2", status=r["status"], bids=len(j.get("bids", [])), asks=len(j.get("asks", [])))
    time.sleep(1.2)
    r = get("summary")
    out(mode="book", call="summary", status=r["status"], bytes=r["bytes"], pairs=len(r["json"] or []), first=trim(json.dumps((r["json"] or [None])[0]), 400))
    time.sleep(1.2)
    r = get("ticker")
    out(mode="book", call="ticker", status=r["status"], bytes=r["bytes"], pairs=len(r["json"] or {}))
    time.sleep(1.2)
    r = get("GetLevel1?OMSId=1&InstrumentId=1")
    out(mode="book", call="GetLevel1", status=r["status"], ms=r["ms"], body=trim(r["text"], 900))


def mode_errors() -> None:
    for p in ["GetL2Snapshot?OMSId=1&InstrumentId=999999&Depth=5", "GetL2Snapshot?OMSId=1&Depth=5", "GetL2Snapshot?OMSId=1&Symbol=BTCCAD&Depth=5",
              "GetL2Snapshot?OMSId=2&InstrumentId=1&Depth=5", "GetLevel1?OMSId=1&InstrumentId=999999", "orderbook?market_pair=FOO_BAR",
              "GetOpenOrders?OMSId=1&AccountId=1", "GetOrderFee?OMSId=1", "doesNotExist"]:
        r = get(p)
        rows = r["json"] if isinstance(r["json"], list) else None
        out(mode="errors", path=p, status=r["status"], body=trim(r["text"], 250), rows=len(rows) if rows is not None else None)
        time.sleep(1.2)


def mode_poll() -> None:
    t_end = time.time() + POLL_S
    tops, ids, ms, limits = [], [], [], set()
    while time.time() < t_end:
        r = get("GetL2Snapshot?OMSId=1&InstrumentId=1&Depth=20")
        rows = r["json"] or []
        st = book_stats(rows)
        tops.append((st["best_bid"], st["best_ask"]))
        ids.append(rows[0][0] if rows else None)
        ms.append(r["ms"])
        limits |= {k for k in r["headers"] if "limit" in k.lower() or "retry" in k.lower()}
        if r["status"] != 200:
            out(mode="poll", refused=r["status"], body=trim(r["text"], 200))
        time.sleep(1.2)
    changes = sum(1 for a, b in zip(tops, tops[1:]) if a != b)
    id_changes = sum(1 for a, b in zip(ids, ids[1:]) if a != b)
    out(mode="poll", replies=len(ms), top_changes=changes, md_update_id_changes=id_changes, first_id=ids[0], last_id=ids[-1], id_sample=ids[:10],
        ms_median=round(statistics.median(ms), 1), ms_max=max(ms), ms_min=min(ms), rate_limit_headers=sorted(limits))


def mode_time() -> None:
    from email.utils import parsedate_to_datetime
    for _ in range(4):
        r = get("GetL2Snapshot?OMSId=1&InstrumentId=1&Depth=1")
        mid = (r["t0"] + r["t1"]) / 2
        date = parsedate_to_datetime(r["headers"]["Date"]).timestamp()
        ts = max(x[2] for x in r["json"]) / 1000 if r["json"] else None
        out(mode="time", http_date_minus_local_s=round(date - mid, 2), newest_action_ms_age=round((mid - ts) * 1000) if ts else None, ms=r["ms"])
        time.sleep(1.2)


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "book": mode_book,
         "errors": mode_errors, "poll": mode_poll, "time": mode_time}

if __name__ == "__main__":
    picked = [a for a in sys.argv[1:] if not a.startswith("--")] or list(MODES)
    out(start=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for m in picked:
        MODES[m]()
