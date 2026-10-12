# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for B2Z Exchange perpetuals, public market data only.

B2Z serves the BTSE API on its own host, so the catalog, anchor and mirror modes read api.btse.com beside it.

Modes, all by default, or name some on the command line:
    host     DNS for the API, socket and web hosts, cold and warm request time, the edge headers
    catalog  /public-api/market/v1/markets for perpetuals: counts by category, quote, active and contractSize,
             the symbol and tradeCurrency spelling, the legacy market_summary rows, and the same catalog on BTSE
    anchor   /futures/api/v2.3/price and /public-api/market/v1/ticker/24hr: rows, size, time, intervals,
             next settlement, and how many index, mark and funding values equal BTSE's read in the same second
    mirror   the BTC-PERP and ETH-PERP REST books read from both hosts at once, five rounds two seconds apart
    poll     /futures/api/v2.3/price once a second for 30 s, counting BTC and ETH index and mark changes
    book     the REST book calls: depth, level order, an unknown symbol
    time     the server time call, whose iso field carries milliseconds, and the HTTP Date header against the local clock

Every call is unauthenticated.
BTSE documents 50 requests per 2 s per IP on the markets API and 15 per second on the legacy futures queries.
B2Z publishes no limit, and this probe stays near 2 requests per second.

Run from the repository root:
    uv run scripts/probes/venues/b2z/rest-probe.py [mode ...]
"""

import collections
import datetime
import email.utils
import json
import socket
import statistics
import sys
import threading
import time
import urllib.error
import urllib.request

B2Z = "https://api.b2z.exchange"
BTSE = "https://api.btse.com"
UA = {"User-Agent": "Mozilla/5.0 (arbitrage-observatory-probe/1.0)", "Accept": "application/json"}
PERPS = "types=%5B%22FuturesPerpetual%22%5D"
KEEP = ("server", "via", "x-cache", "x-amz-cf-pop", "cf-ray", "cache-control", "retry-after", "content-type")


def out(**kv) -> None:
    print(json.dumps(kv, ensure_ascii=False), flush=True)


def get(url: str, gap: float = 0.5) -> tuple[int, dict, bytes, float]:
    time.sleep(gap)
    req = urllib.request.Request(url, headers=UA)
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            status, hdrs, body = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        status, hdrs, body = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    return status, hdrs, body, round((time.perf_counter() - t0) * 1000, 1)


def both(path: str) -> dict:
    """Reads one path from both hosts at the same instant, in two threads."""
    res = {}

    def run(name, host):
        res[name] = get(host + path, gap=0)

    ts = [threading.Thread(target=run, args=(n, h)) for n, h in (("b2z", B2Z), ("btse", BTSE))]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    time.sleep(0.5)
    return res


def host_mode() -> None:
    for name in ("api.b2z.exchange", "ws.b2z.exchange", "www.b2z.exchange", "b2z.exchange"):
        t0 = time.perf_counter()
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as e:
            addrs = [f"error {e}"]
        out(mode="host", name=name, addrs=addrs, ms=round((time.perf_counter() - t0) * 1000, 1))
    times = []
    for i in range(6):
        status, hdrs, body, ms = get(B2Z + "/spot/api/v3.3/time", gap=0.5)
        times.append(ms)
        if i == 0:
            out(mode="host", call="/spot/api/v3.3/time", status=status, body=body.decode()[:100],
                headers={k: hdrs[k] for k in KEEP if k in hdrs})
    out(mode="host", cold_ms=times[0], warm_ms=times[1:])
    for url in ("https://www.b2z.exchange/", "https://api.b2z.exchange/", "https://api.b2z.exchange/futures/api/v2.3/time"):
        status, hdrs, body, ms = get(url)
        out(mode="host", url=url, status=status, bytes=len(body), ms=ms, server=hdrs.get("server"),
            pop=hdrs.get("x-amz-cf-pop"), title=body.decode("utf-8", "replace").split("<title>")[1].split("<")[0]
            if b"<title>" in body else None)


def markets(host: str) -> tuple[list, int, float]:
    status, _, body, ms = get(host + "/public-api/market/v1/markets?" + PERPS)
    return json.loads(body)["data"]["symbols"], len(body), ms


def catalog_mode() -> None:
    rows, size, ms = markets(B2Z)
    out(mode="catalog", host="b2z", rows=len(rows), bytes=size, ms=ms,
        types=dict(collections.Counter(r["type"] for r in rows)),
        categories=dict(collections.Counter(r["category"] for r in rows)),
        quotes=dict(collections.Counter(r["quoteCurrency"] for r in rows)),
        active=dict(collections.Counter(str(r["active"]) for r in rows)),
        contract_sizes=dict(sorted(collections.Counter(str(r.get("contractSize")) for r in rows).items())),
        suffix_rule=sum(r["symbol"] == r["tradeCurrency"] + "-USDT" for r in rows),
        bases_listed_twice=[b for b, n in collections.Counter(r["baseCurrency"] for r in rows).items() if n > 1],
        settlement_list_sizes=dict(collections.Counter(len(r.get("availableSettlement") or []) for r in rows)))
    btc = next(r for r in rows if r["tradeCurrency"] == "BTC-PERP")
    out(mode="catalog", host="b2z", btc={k: btc.get(k) for k in ("symbol", "tradeCurrency", "baseCurrency", "quoteCurrency",
                                                                   "active", "contractSize", "minPriceIncrement", "category")})
    status, _, body, ms = get(B2Z + "/public-api/market/v1/markets")
    every = json.loads(body)["data"]["symbols"]
    out(mode="catalog", host="b2z", call="markets, no filter", status=status, rows=len(every), bytes=len(body), ms=ms,
        by_type=dict(collections.Counter(r["type"] for r in every)))
    status, _, body, ms = get(B2Z + "/futures/api/v2.3/market_summary")
    ms_rows = json.loads(body)
    perp_ms = [r for r in ms_rows if r["symbol"].endswith("-PERP")]
    out(mode="catalog", host="b2z", call="/futures/api/v2.3/market_summary", status=status, rows=len(ms_rows), bytes=len(body),
        ms=ms, perp_rows=len(perp_ms), other=[r["symbol"] for r in ms_rows if not r["symbol"].endswith("-PERP")])
    brows, _, _ = markets(BTSE)
    mine = {r["symbol"]: r for r in rows}
    theirs = {r["symbol"]: r for r in brows}
    common = set(mine) & set(theirs)
    out(mode="catalog", host="both", b2z=len(mine), btse=len(theirs), common=len(common),
        only_b2z=sorted(set(mine) - set(theirs)), only_btse=sorted(set(theirs) - set(mine)),
        same_contract_size=sum(mine[s].get("contractSize") == theirs[s].get("contractSize") for s in common),
        same_tick=sum(mine[s].get("minPriceIncrement") == theirs[s].get("minPriceIncrement") for s in common))


def anchor_mode() -> None:
    res = both("/futures/api/v2.3/price")
    p = {n: {r["symbol"]: r for r in json.loads(v[2])} for n, v in res.items()}
    common = set(p["b2z"]) & set(p["btse"])
    out(mode="anchor", call="/futures/api/v2.3/price", b2z_status=res["b2z"][0], rows=len(p["b2z"]), bytes=len(res["b2z"][2]),
        ms=res["b2z"][3], btse_rows=len(p["btse"]), common=len(common),
        same_index=sum(p["b2z"][s]["indexPrice"] == p["btse"][s]["indexPrice"] for s in common),
        same_mark=sum(p["b2z"][s]["markPrice"] == p["btse"][s]["markPrice"] for s in common),
        index_gap_ppm_max=max(abs(p["b2z"][s]["indexPrice"] / p["btse"][s]["indexPrice"] - 1) * 1e6 for s in common
                              if p["btse"][s]["indexPrice"]) // 1,
        zero_mark=sum(not r["markPrice"] for r in p["b2z"].values()),
        btc=p["b2z"].get("BTC-PERP"), btc_btse=p["btse"].get("BTC-PERP"))
    res = both("/public-api/market/v1/ticker/24hr?" + PERPS)
    t = {n: {r["symbol"]: r for r in json.loads(v[2])["data"]} for n, v in res.items()}
    rows = t["b2z"]
    common = set(rows) & set(t["btse"])
    out(mode="anchor", call="/public-api/market/v1/ticker/24hr", b2z_status=res["b2z"][0], rows=len(rows),
        bytes=len(res["b2z"][2]), ms=res["b2z"][3],
        intervals=dict(collections.Counter(r.get("fundingIntervalMinutes") for r in rows.values())),
        next_funding=dict(collections.Counter(r.get("nextFundingTime") for r in rows.values())),
        same_rate=sum(rows[s]["fundingRate"] == t["btse"][s]["fundingRate"] for s in common),
        same_next=sum(rows[s]["nextFundingTime"] == t["btse"][s]["nextFundingTime"] for s in common),
        same_open_interest=sum(rows[s].get("openInterest") == t["btse"][s].get("openInterest") for s in common),
        common=len(common), btc={k: rows["BTC-PERP-USDT"].get(k) for k in ("fundingRate", "fundingIntervalMinutes",
                                                                           "nextFundingTime", "openInterest", "closeTime")})
    status, _, body, ms = get(B2Z + "/public-api/market/v1/ticker/indices?" + PERPS)
    d = json.loads(body)
    out(mode="anchor", call="/public-api/market/v1/ticker/indices", status=status, bytes=len(body), ms=ms,
        rows=len(d.get("data", [])), first=(d.get("data") or [None])[0])


def top(book: dict, n: int = 5) -> tuple:
    bids = [(l["price"], l["size"]) for l in book.get("buyQuote", [])][:n]
    asks = [(l["price"], l["size"]) for l in book.get("sellQuote", [])][:n]  # v2.3 L2 lists asks ascending, best first
    return tuple(bids), tuple(asks)


def mirror_mode() -> None:
    for sym in ("BTC-PERP", "ETH-PERP"):
        for rnd in range(5):
            res = both(f"/futures/api/v2.3/orderbook/L2?symbol={sym}")
            a, b = json.loads(res["b2z"][2]), json.loads(res["btse"][2])
            ta, tb = top(a), top(b)
            levels_a = {(l["price"], l["size"]) for l in a["buyQuote"] + a["sellQuote"]}
            levels_b = {(l["price"], l["size"]) for l in b["buyQuote"] + b["sellQuote"]}
            out(mode="mirror", symbol=sym, round=rnd, b2z_ts=a.get("timestamp"), btse_ts=b.get("timestamp"),
                top5_equal=ta == tb, shared_levels=len(levels_a & levels_b), b2z_levels=len(levels_a),
                btse_levels=len(levels_b), b2z_best=(ta[0][0] if ta[0] else None, ta[1][0] if ta[1] else None),
                btse_best=(tb[0][0] if tb[0] else None, tb[1][0] if tb[1] else None))
            time.sleep(1.5)


def poll_mode() -> None:
    last, changes, times = {}, collections.Counter(), []
    for _ in range(31):
        status, _, body, ms = get(B2Z + "/futures/api/v2.3/price", gap=1.0)
        times.append(ms)
        rows = {r["symbol"]: r for r in json.loads(body)}
        for sym in ("BTC-PERP", "ETH-PERP"):
            r = rows[sym]
            if sym in last:
                for f in ("indexPrice", "markPrice"):
                    changes[f"{sym} {f}"] += r[f] != last[sym][f]
            last[sym] = r
    out(mode="poll", polls=31, intervals=30, changes=dict(changes), median_ms=statistics.median(times), max_ms=max(times))


def book_mode() -> None:
    for path in ("/futures/api/v2.3/orderbook/L2?symbol=BTC-PERP", "/futures/api/v2.3/orderbook/L2?symbol=BTC-PERP&depth=100",
                 "/public-api/market/v1/orderbook?symbol=BTC-PERP-USDT", "/futures/api/v2.3/orderbook/L2?symbol=NOPE-PERP"):
        status, hdrs, body, ms = get(B2Z + path)
        try:
            d = json.loads(body)
        except ValueError:
            out(mode="book", path=path, status=status, body=body.decode("utf-8", "replace")[:200])
            continue
        d = d.get("data", d) if isinstance(d, dict) else d
        if isinstance(d, dict) and ("buyQuote" in d or "bids" in d):
            bids = d.get("buyQuote") or d.get("bids") or []
            asks = d.get("sellQuote") or d.get("asks") or []
            bp = [float(l["price"] if isinstance(l, dict) else l[0]) for l in bids]
            ap = [float(l["price"] if isinstance(l, dict) else l[0]) for l in asks]
            out(mode="book", path=path, status=status, ms=ms, bytes=len(body), bids=len(bids), asks=len(asks),
                bids_desc=bp == sorted(bp, reverse=True), asks_desc=ap == sorted(ap, reverse=True), asks_asc=ap == sorted(ap),
                best_bid=max(bp) if bp else None, best_ask=min(ap) if ap else None,
                first_ask=asks[0] if asks else None, cache=hdrs.get("x-cache"), timestamp=d.get("timestamp"))
        else:
            out(mode="book", path=path, status=status, ms=ms, body=body.decode("utf-8", "replace")[:300])


def time_mode() -> None:
    for _ in range(3):
        time.sleep(0.5)
        t0 = time.time()
        status, hdrs, body, ms = get(B2Z + "/spot/api/v3.3/time", gap=0)
        t1 = time.time()
        d = json.loads(body)
        date = email.utils.parsedate_to_datetime(hdrs["date"]).timestamp() if "date" in hdrs else None
        iso = datetime.datetime.fromisoformat(d["iso"].replace("Z", "+00:00")).timestamp()
        out(mode="time", status=status, body=d, rtt_ms=ms, iso_minus_local_mid_ms=round((iso - (t0 + t1) / 2) * 1000),
            date_minus_local_mid_s=round(date - (t0 + t1) / 2, 2) if date else None)


MODES = {"host": host_mode, "catalog": catalog_mode, "anchor": anchor_mode, "mirror": mirror_mode,
         "poll": poll_mode, "book": book_mode, "time": time_mode}

if __name__ == "__main__":
    picked = sys.argv[1:] or list(MODES)
    out(probe="b2z rest", started=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), modes=picked)
    for m in picked:
        MODES[m]()
