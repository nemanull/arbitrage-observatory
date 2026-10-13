# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27,<1", "ccxt==4.5.68"]
# ///
"""Read-only REST probe for the ApeX Omni public API, the catalog, the anchor calls and CCXT's mapping.

Public and unauthenticated. No wallet, no signature, no private endpoint, no order.
The documented budget is 600 requests a minute per IP, and no mode sends more than about 40 in a minute.

Run from the repository root:
    uv run scripts/probes/venues/apex/rest-probe.py [host|catalog|ccxt|anchor|funding|book|errors|time]

Modes:
    host     DNS, edge headers and the latency of ten /v3/time calls on one kept connection.
    catalog  /v3/symbols: families, flags, naming, sizes and the rows that are trading but hidden.
    ccxt     CCXT 4.5.68 loadMarkets through the connector's filter: ids, contractSize, taker, maker.
    anchor   30 polls of /v3/data/all-ticker-info one second apart: latency, fields, change counts, mark against index.
    funding  /v3/history-funding over 24 h on three perps: interval, instants, caps and the price column.
    book     /v3/depth at several limits: level counts, order, u, caching, dead and stock books, size unit.
    errors   unknown and malformed symbols and paths on every public call.
    time     /v3/time against the local clock with round trip bounds.

Captures go to .claude/survey-work/apex/ unless PROBE_OUT_DIR names another folder.
Recorded in docs/profiles/apex/rest.md and docs/profiles/apex/fees.md.
"""

import json
import os
import socket
import statistics
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import httpx

HOST = "omni.apex.exchange"
API = f"https://{HOST}/api"
REPO = Path(__file__).resolve().parents[4]
OUT = Path(os.environ.get("PROBE_OUT_DIR", REPO / ".claude/survey-work/apex"))
STAMP = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
HEADERS = {"User-Agent": "observatory-probe", "Accept": "application/json"}


def log(tag, **kw):
    print(json.dumps({"tag": tag, **kw}, default=str), flush=True)


def stats(xs):
    if not xs:
        return {"n": 0}
    s = sorted(xs)
    pick = lambda q: s[min(len(s) - 1, int(q * len(s)))]
    return {"n": len(s), "min": round(s[0], 3), "p10": round(pick(0.1), 3), "p50": round(statistics.median(s), 3), "p90": round(pick(0.9), 3), "max": round(s[-1], 3)}


def client(**kw):
    return httpx.Client(headers=HEADERS, timeout=30, **kw)


def timed(c, path):
    t0 = time.perf_counter()
    r = c.get(API + path)
    ms = (time.perf_counter() - t0) * 1000
    return r, ms


def edge_cached(r):
    """A reply from the CDN's own cache carries an Age header over HTTP/1.1, and a last x-via hop tagged "0.0" over HTTP/2."""
    hops = [h.strip() for h in r.headers.get("x-via", "").split(",") if h.strip()]
    return "age" in r.headers or (bool(hops) and hops[-1].startswith("0.0"))


def save(name, obj):
    OUT.mkdir(parents=True, exist_ok=True)
    p = OUT / f"rest-{name}-{STAMP}.json"
    p.write_text(json.dumps(obj, default=str))
    log("saved", path=str(p))


def symbols(c):
    r, ms = timed(c, "/v3/symbols")
    return r.json()["data"], ms, len(r.content)


def mode_host():
    for h in (HOST, "quote.omni.apex.exchange", "api-docs.omni.apex.exchange"):
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(h, 443, proto=socket.IPPROTO_TCP)})
            cname = socket.gethostbyname_ex(h)
            log("dns", host=h, addresses=addrs, canonical=cname[0], aliases=cname[1])
        except Exception as e:
            log("dns", host=h, error=repr(e))
    with client() as c:
        times = []
        for i in range(10):
            r, ms = timed(c, "/v3/time")
            times.append(ms)
            if i == 0:
                log("first", ms=round(ms, 1), status=r.status_code, headers={k: v for k, v in r.headers.items() if k.lower() in ("server", "x-via", "via", "x-cache", "cache-control", "content-encoding", "set-cookie", "x-ws-request-id", "age")})
            time.sleep(0.3)
        log("time_latency", ms=stats(times), first=round(times[0], 1))
        sym = []
        for i in range(3):
            r, ms = timed(c, "/v3/symbols")
            sym.append(ms)
            time.sleep(0.5)
        log("symbols_latency", ms=stats(sym), bytes=len(r.content), encoding=r.headers.get("content-encoding"))


def mode_catalog():
    with client() as c:
        data, ms, size = symbols(c)
    cc = data["contractConfig"]
    log("catalog_call", ms=round(ms, 1), bytes=size, top=list(data.keys()), contract_keys=list(cc.keys()))
    for fam in ("perpetualContract", "stockContract", "predictionContract", "prelaunchContract"):
        rows = cc.get(fam) or []
        flags = Counter((x.get("enableTrade"), x.get("enableDisplay"), x.get("enableOpenPosition")) for x in rows)
        log("family", family=fam, rows=len(rows), trade_display_open=[[list(k), v] for k, v in flags.items()], settle=dict(Counter(x.get("settleAssetId") for x in rows)), contract_type=dict(Counter(x.get("contractType") for x in rows)), prelaunch=dict(Counter(x.get("isPrelaunch") for x in rows)))
    pc = cc["perpetualContract"]
    act = [x for x in pc if x["enableTrade"]]
    odd = [{k: x.get(k) for k in ("symbol", "crossSymbolName", "enableDisplay", "enableOpenPosition", "contractType", "deliveryTime", "pullOffTime", "disableOpenPositionTime", "enableFundingSettlement")} for x in act if not (x["enableDisplay"] and x["enableOpenPosition"])]
    log("perp_active", n=len(act), odd=odd, symbol_rule=sum(x["symbol"] == x["baseTokenId"] + "-USDT" for x in act), cross_rule=sum(x["crossSymbolName"] == x["baseTokenId"] + "USDT" for x in act), display_equals_cross=sum(x["symbolDisplayName"] == x["crossSymbolName"] for x in act), digit_bases=[x["baseTokenId"] for x in act if x["baseTokenId"][0].isdigit()], min_neq_step=[(x["symbol"], x["minOrderSize"], x["stepSize"]) for x in act if Decimal(x["minOrderSize"]) != Decimal(x["stepSize"])], bases_twice=[b for b, n in Counter(x["baseTokenId"] for x in act).items() if n > 1], funding_settlement=dict(Counter(x["enableFundingSettlement"] for x in act)), funding_max=dict(Counter(x["fundingMaxRate"] for x in act)), funding_min=dict(Counter(x["fundingMinRate"] for x in act)), interest=dict(Counter(x["fundingInterestRate"] for x in act)), impact_notional=dict(Counter(x["fundingImpactMarginNotional"] for x in act)), index_var_rate=dict(Counter(x["indexPriceVarRate"] for x in act)), max_market_price_range=dict(Counter(x["maxMarketPriceRange"] for x in act)), leverage=dict(Counter(x["displayMaxLeverage"] for x in act)))
    inactive = [x for x in pc if not x["enableTrade"]]
    log("perp_inactive", n=len(inactive), examples=[x["symbol"] for x in inactive][:50])
    stocks = [x for x in cc.get("stockContract", []) if x["enableTrade"]]
    log("stock_active", n=len(stocks), names=[x["crossSymbolName"] for x in stocks], category=dict(Counter(x.get("category") for x in stocks)), tags=dict(Counter(x.get("tag") for x in stocks)), funding_max=dict(Counter(x["fundingMaxRate"] for x in stocks)))
    perp_bases = {x["baseTokenId"] for x in act}
    log("stock_perp_overlap", bases=sorted(perp_bases & {x["baseTokenId"] for x in stocks}))
    save("catalog", data)


def mode_ccxt():
    import ccxt

    ex = ccxt.apex()
    t0 = time.perf_counter()
    mk = ex.load_markets()
    ms = (time.perf_counter() - t0) * 1000
    swaps = [m for m in mk.values() if m.get("type") == "swap" and m.get("swap") and m.get("active") is not False]
    lin = [m for m in swaps if m.get("linear") and m.get("quote") in ("USDT", "USDC", "USD")]
    log("ccxt", version=ccxt.__version__, load_ms=round(ms, 1), markets=len(mk), active_swaps=len(swaps), linear_usd_family=len(lin), types=dict(Counter(m.get("type") for m in mk.values())), inactive=sum(1 for m in mk.values() if m.get("active") is False))
    log("ccxt_mapping", id_equals_symbol_field=sum(m["id"] == m["info"]["symbol"] for m in swaps), id2_equals_cross=sum(m.get("id2") == m["info"]["crossSymbolName"] for m in swaps), id_examples=[(m["symbol"], m["id"], m.get("id2")) for m in swaps[:4]], quote=dict(Counter(m["quote"] for m in swaps)), settle=dict(Counter(m["settle"] for m in swaps)), linear=dict(Counter(m["linear"] for m in swaps)), taker=dict(Counter(m["taker"] for m in swaps)), maker=dict(Counter(m["maker"] for m in swaps)), contract_size_equals_min_order=sum(m["contractSize"] == float(m["info"]["minOrderSize"]) for m in swaps), contract_size_values=dict(Counter(m["contractSize"] for m in swaps).most_common(12)), contract_size_one=sum(m["contractSize"] == 1 for m in swaps), symbols_twice=[s for s, n in Counter((m["base"], m["quote"]) for m in swaps).items() if n > 1], fees_swap=ex.fees.get("swap"), rate_limit_ms=ex.rateLimit)
    btc = mk.get("BTC/USDT:USDT")
    log("ccxt_btc", taker=btc["taker"], maker=btc["maker"], contractSize=btc["contractSize"], id=btc["id"], id2=btc.get("id2"), precision=btc["precision"], limits_amount=btc["limits"]["amount"])
    save("ccxt", [{k: m.get(k) for k in ("id", "id2", "symbol", "base", "quote", "settle", "active", "linear", "contractSize", "taker", "maker")} for m in swaps])


def mode_anchor():
    with client() as c:
        data, _, _ = symbols(c)
        pc = {x["crossSymbolName"]: x for x in data["contractConfig"]["perpetualContract"] if x["enableTrade"]}
        polls = []
        began = time.perf_counter()
        for i in range(30):
            if time.perf_counter() - began > 150:
                break
            start = time.perf_counter()
            r, ms = timed(c, "/v3/data/all-ticker-info")
            arr = time.time() * 1000
            body = r.json()
            rows = {x["symbol"]: x for x in body.get("data", [])}
            polls.append({"ms": ms, "bytes": len(r.content), "encoding": r.headers.get("content-encoding"), "timeCost": body.get("timeCost"), "cached": edge_cached(r), "arr": arr, "rows": {s: rows.get(s) for s in pc}, "n": len(rows)})
            time.sleep(max(0, 1 - (time.perf_counter() - start)))
        r2, ms2 = timed(c, "/v3/ticker?symbol=BTCUSDT")
        single = r2.json()["data"][0]
    lat = [p["ms"] for p in polls]
    same_as_previous = sum(1 for a, b in zip(polls, polls[1:]) if a["rows"] == b["rows"])
    log("anchor_edge", cached=sum(1 for p in polls if p["cached"]), origin=sum(1 for p in polls if not p["cached"]), ms_cached=stats([p["ms"] for p in polls if p["cached"]]), ms_origin=stats([p["ms"] for p in polls if not p["cached"]]), identical_to_previous_poll=same_as_previous, sequence="".join("c" if p["cached"] else "o" for p in polls))
    log("anchor_latency", ms=stats(lat), over_2s=sum(1 for x in lat if x > 2000), over_1s=sum(1 for x in lat if x > 1000), bytes=stats([p["bytes"] for p in polls]), encoding=dict(Counter(p["encoding"] for p in polls)), rows=dict(Counter(p["n"] for p in polls)), time_cost=stats([p["timeCost"] for p in polls if isinstance(p["timeCost"], (int, float))]), slow_time_cost=[p["timeCost"] for p in polls if p["ms"] > 2000])
    last = polls[-1]["rows"]
    missing = [s for s, x in last.items() if x is None]
    fields = Counter(k for x in last.values() if x for k in x)
    empty = Counter(k for x in last.values() if x for k, v in x.items() if v in ("", None))
    zero_mark = [s for s, x in last.items() if x and x.get("markPrice") in ("0", "", None)]
    zero_index = [s for s, x in last.items() if x and x.get("indexPrice") in ("0", "", None)]
    eq = [s for s, x in last.items() if x and x.get("markPrice") == x.get("indexPrice")]
    dist = sorted(abs(float(x["markPrice"]) / float(x["indexPrice"]) - 1) * 1e6 for x in last.values() if x and x.get("indexPrice") not in ("0", "", None) and x.get("markPrice") not in ("0", "", None))
    nft = Counter(x.get("nextFundingTime") for x in last.values() if x)
    fr = Counter(x.get("fundingRate") for x in last.values() if x)
    pfr_eq = sum(1 for x in last.values() if x and x.get("fundingRate") == x.get("predictedFundingRate"))
    over_cap = [(s, x["fundingRate"], pc[s]["fundingMaxRate"]) for s, x in last.items() if x and abs(float(x["fundingRate"])) > float(pc[s]["fundingMaxRate"])]
    log("anchor_fields", missing=missing, fields=dict(fields), empty=dict(empty), zero_mark=zero_mark, zero_index=zero_index, mark_equals_index=eq, mark_index_ppm=stats(dist), next_funding=dict(nft), funding_rate_top=fr.most_common(5), funding_equals_predicted=pfr_eq, predicted_top=Counter(x.get("predictedFundingRate") for x in last.values() if x).most_common(4), widest=max(((round(abs(float(x["markPrice"]) / float(x["indexPrice"]) - 1) * 1e6), s) for s, x in last.items() if x and x.get("indexPrice") not in ("0", "", None)), default=None), over_cap=over_cap, single_btc=single)
    changes = defaultdict(Counter)
    for a, b in zip(polls, polls[1:]):
        for s in pc:
            xa, xb = a["rows"].get(s), b["rows"].get(s)
            if not xa or not xb:
                continue
            for f in ("indexPrice", "markPrice", "lastPrice", "fundingRate", "predictedFundingRate", "openInterest", "nextFundingTime"):
                if xa.get(f) != xb.get(f):
                    changes[s][f] += 1
    tr = len(polls) - 1
    agg = {f: stats([changes[s][f] for s in pc]) for f in ("indexPrice", "markPrice", "lastPrice", "fundingRate", "predictedFundingRate", "openInterest")}
    log("anchor_changes", transitions=tr, per_symbol={s: dict(changes[s]) for s in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT", "APEXUSDT", "IOUSDT", "STBLUSDT")}, across_symbols=agg, never_index=[s for s in pc if changes[s]["indexPrice"] == 0], never_mark=[s for s in pc if changes[s]["markPrice"] == 0])
    moves = []
    for a, b in zip(polls, polls[1:]):
        for s in pc:
            xa, xb = a["rows"].get(s), b["rows"].get(s)
            if xa and xb:
                for f in ("indexPrice", "markPrice"):
                    va, vb = float(xa[f] or 0), float(xb[f] or 0)
                    if va > 0 and vb > 0:
                        moves.append((abs(vb / va - 1) * 1e6, s, f))
    moves.sort(reverse=True)
    log("anchor_moves", over_1000ppm=[(round(m, 1), s, f) for m, s, f in moves if m > 1000][:20], count_over_1000=sum(1 for m, _, _ in moves if m > 1000), of=len(moves))
    save("anchor", [{k: v for k, v in p.items() if k != "rows"} | {"btc": p["rows"].get("BTCUSDT")} for p in polls])


def mode_funding():
    now = int(time.time() * 1000)
    with client() as c:
        data, _, _ = symbols(c)
        pc = {x["symbol"]: x for x in data["contractConfig"]["perpetualContract"]}
        tick = {x["symbol"]: x for x in c.get(API + "/v3/data/all-ticker-info").json()["data"]}
        for sym in ("BTC-USDT", "ETH-USDT", "TRX-USDT", "DOGE-USDT"):
            r, ms = timed(c, f"/v3/history-funding?symbol={sym}&limit=100&beginTimeInclusive={now - 86_400_000}")
            body = r.json()
            rows = body.get("data", {}).get("historyFunds", [])
            ts = sorted(x["fundingTimestamp"] for x in rows)
            gaps = [(b - a) / 3_600_000 for a, b in zip(ts, ts[1:])]
            offsets = Counter(t % 3_600_000 for t in ts)
            rates = [Decimal(x["rate"]) for x in rows]
            cap = Decimal(pc[sym]["fundingMaxRate"])
            cross = pc[sym]["crossSymbolName"]
            log("funding", symbol=sym, ms=round(ms, 1), rows=len(rows), total_size=body.get("data", {}).get("totalSize"), interval_hours=dict(Counter(gaps)), ms_past_hour=dict(offsets), newest=rows[0] if rows else None, oldest_ts=ts[0] if ts else None, newest_ts=ts[-1] if ts else None, at_interest=sum(1 for x in rates if x == Decimal("0.0000125")), max_abs=str(max((abs(x) for x in rates), default=0)), cap=str(cap), at_cap=sum(1 for x in rates if abs(x) == cap), keys=sorted(rows[0].keys()) if rows else [], ticker_now={k: tick.get(cross, {}).get(k) for k in ("fundingRate", "predictedFundingRate", "nextFundingTime", "indexPrice", "markPrice")})
            time.sleep(0.5)
        r, ms = timed(c, "/v3/history-funding?symbol=BTC-USDT")
        body = r.json()
        log("funding_default", rows=len(body.get("data", {}).get("historyFunds", [])), total_size=body.get("data", {}).get("totalSize"), newest=(body.get("data", {}).get("historyFunds") or [None])[0])
        r, ms = timed(c, "/v3/history-funding?symbol=BTCUSDT")
        log("funding_cross_name", status=r.status_code, body=r.text[:300])


def order_of(levels):
    ps = [float(p) for p, _ in levels]
    if len(ps) < 2:
        return "short"
    if all(a > b for a, b in zip(ps, ps[1:])):
        return "descending"
    if all(a < b for a, b in zip(ps, ps[1:])):
        return "ascending"
    return "unordered"


def mode_book():
    with client() as c:
        data, _, _ = symbols(c)
        steps = {x["crossSymbolName"]: Decimal(x["stepSize"]) for k in ("perpetualContract", "stockContract") for x in data["contractConfig"][k]}
        for q in ("", "&limit=25", "&limit=100", "&limit=200", "&limit=500", "&limit=1000"):
            r, ms = timed(c, f"/v3/depth?symbol=BTCUSDT{q}")
            d = r.json().get("data", {})
            log("depth", query=q or "default", status=r.status_code, ms=round(ms, 1), bids=len(d.get("b", [])), asks=len(d.get("a", [])), bid_order=order_of(d.get("b", [])), ask_order=order_of(d.get("a", [])), u=d.get("u"), keys=sorted(d.keys()), bytes=len(r.content), encoding=r.headers.get("content-encoding"), time_cost=r.json().get("timeCost"))
            time.sleep(0.3)
        pair = []
        for _ in range(2):
            r, ms = timed(c, "/v3/depth?symbol=ETHUSDT&limit=25")
            pair.append((time.time() * 1000, r.json()["data"]))
            time.sleep(0.5)
        log("depth_cache", u=[p[1]["u"] for p in pair], same_levels=pair[0][1]["b"] == pair[1][1]["b"] and pair[0][1]["a"] == pair[1][1]["a"], apart_ms=round(pair[1][0] - pair[0][0], 1))
        for sym in ("IOUSDT", "STBLUSDT", "AAPLUSDT", "TRXUSDT", "MATICUSDT", "1000PEPEUSDT"):
            r, ms = timed(c, f"/v3/depth?symbol={sym}&limit=25")
            body = r.json()
            d = body.get("data") or {}
            lv = (d.get("b") or []) + (d.get("a") or [])
            st = steps.get(sym)
            mult = sum(1 for _, q in lv if st and (Decimal(q) / st) == (Decimal(q) / st).to_integral_value()) if st else None
            log("depth_symbol", symbol=sym, status=r.status_code, bids=len(d.get("b") or []), asks=len(d.get("a") or []), u=d.get("u"), top_bid=(d.get("b") or [None])[0], top_ask=(d.get("a") or [None])[0], step=str(st), sizes_multiple_of_step=mult, levels=len(lv), body=body if not lv else None)
            time.sleep(0.3)
        r = c.get(API + "/v3/ticker?symbol=BTCUSDT").json()["data"][0]
        d = c.get(API + "/v3/depth?symbol=BTCUSDT&limit=25").json()["data"]
        bid_notional = sum(float(p) * float(q) for p, q in d["b"])
        log("size_unit", btc_volume24h=r["volume24h"], btc_turnover24h=r["turnover24h"], implied_price=round(float(r["turnover24h"]) / float(r["volume24h"]), 1), last=r["lastPrice"], top_bid=d["b"][0], top25_bid_notional_usdt=round(bid_notional, 0), btc_step=str(steps["BTCUSDT"]))


def mode_errors():
    cases = [
        "/v3/ticker?symbol=NOPEUSDT", "/v3/ticker?symbol=BTC-USDT", "/v3/ticker?symbol=btcusdt", "/v3/ticker",
        "/v3/depth?symbol=NOPEUSDT", "/v3/depth?symbol=BTC-USDT", "/v3/depth", "/v3/depth?symbol=BTCUSDT&limit=abc",
        "/v3/history-funding?symbol=NOPE-USDT", "/v3/history-funding",
        "/v3/nope", "/v2/symbols", "/v3/data/nope",
    ]
    with client() as c:
        for p in cases:
            r, ms = timed(c, p)
            log("error_case", path=p, status=r.status_code, content_type=r.headers.get("content-type"), retry_after=r.headers.get("retry-after"), ms=round(ms, 1), body=r.text[:300])
            time.sleep(0.4)
        r = c.post(API + "/v3/symbols")
        log("error_case", path="POST /v3/symbols", status=r.status_code, body=r.text[:300])
        r = c.get(API + "/v3/time")
        log("limit_headers", headers={k: v for k, v in r.headers.items() if "limit" in k.lower() or "retry" in k.lower() or "remaining" in k.lower()})


def mode_time():
    with client() as c:
        rows = []
        for _ in range(10):
            t0 = time.time() * 1000
            r = c.get(API + "/v3/time")
            t1 = time.time() * 1000
            st = r.json()["data"]["time"]
            rows.append({"rtt": t1 - t0, "lo": t0 - st, "hi": t1 - st, "server": st, "cached": edge_cached(r)})
            time.sleep(0.3)
    origin = [x for x in rows if not x["cached"]] or rows
    best = min(origin, key=lambda x: x["rtt"])
    cached = [x for x in rows if x["cached"]]
    log("time_cached", n=len(cached), rtt=stats([x["rtt"] for x in cached]), local_mid_minus_server=stats([(x["lo"] + x["hi"]) / 2 for x in cached]))
    log("time", unit="ms" if rows[0]["server"] > 1e12 else "s", best_rtt=round(best["rtt"], 1), local_minus_server_between=(round(best["lo"], 1), round(best["hi"], 1)), all_rtt=stats([x["rtt"] for x in rows]))


MODES = {"host": mode_host, "catalog": mode_catalog, "ccxt": mode_ccxt, "anchor": mode_anchor, "funding": mode_funding, "book": mode_book, "errors": mode_errors, "time": mode_time}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "host"
    log("start", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
    MODES[mode]()
    log("end", mode=mode, utc=datetime.now(timezone.utc).isoformat(timespec="seconds"))
