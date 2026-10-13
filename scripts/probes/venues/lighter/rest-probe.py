# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27,<1"]
# ///
"""Lighter REST probe for docs/profiles/lighter/rest.md.

Public, unauthenticated and read-only. It never signs, never calls sendTx and never names an account.
An unauthenticated caller is a Standard account, documented at 60 requests per rolling minute per IP,
so every request in this process is spaced at least PACE_S apart, which keeps a mode under half that budget.

Modes, run one at a time:
  host     DNS, edge headers, cold and warm request time on the status call and orderBookDetails.
  catalog  orderBookDetails with no filter and with filter=perp, summarised per market type, status and field.
  oracle   priceOracleInfo for every market: index and mark sources, medians, internal price flags, caps.
  anchor   orderBookDetails?filter=perp every 3 s for 57 s, counting index and mark changes per market and the edge cache,
           then funding-rates once and fundings for BTC and ETH over the last 24 hours.
  book     orderBookOrders depth, order, units and caching, plus orderBooks and exchangeStats once.
  errors   unknown market, bad parameter, unknown path, wrong method.
  time     the status call's timestamp against the local clock.

Run from the repository root with: uv run scripts/probes/venues/lighter/rest-probe.py <mode> [label]
Captures land in .claude/survey-work/lighter/.
"""

import collections
import json
import pathlib
import socket
import statistics
import sys
import time

import httpx

BASE = "https://mainnet.zklighter.elliot.ai"
API = BASE + "/api/v1/"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "lighter"
WORK.mkdir(parents=True, exist_ok=True)
UA = "arbitrage-observatory-probe/1.0 (read-only research)"
PACE_S = 2.0
EDGE_HEADERS = ("server", "via", "x-cache", "x-amz-cf-pop", "x-amz-cf-id", "cf-ray", "content-type",
                "content-encoding", "content-length", "cache-control", "age", "retry-after", "date")
_last = [0.0]
OUT = {}


def pace():
    wait = _last[0] + PACE_S - time.monotonic()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.monotonic()


def call(client, path, params=None, method="GET", base=API, record_refusal=False):
    pace()
    url = base + path
    t0 = time.perf_counter()
    r = client.request(method, url, params=params)
    ms = (time.perf_counter() - t0) * 1000
    body = r.content
    rec = {
        "url": str(r.request.url), "method": method, "status": r.status_code, "ms": round(ms, 1),
        "bytes": len(body), "wire_bytes": r.num_bytes_downloaded,
        "headers": {k: v for k, v in r.headers.items() if k.lower() in EDGE_HEADERS or k.lower().startswith("x-ratelimit")},
        "local_ms": int(time.time() * 1000),
    }
    try:
        rec["json"] = r.json()
    except Exception:
        rec["text"] = body[:400].decode("utf-8", "replace")
    if r.status_code in (403, 418, 429) and not record_refusal:
        print("rate limited or refused, stopping:", rec["status"], rec["headers"], rec.get("text") or rec.get("json"))
        OUT["refused"] = rec
        save()
        sys.exit(2)
    return rec


def save():
    path = WORK / f"rest-{MODE}-{LABEL}.json"
    path.write_text(json.dumps(OUT, indent=1, default=str))
    print("saved", path.relative_to(ROOT))


def brief(rec):
    return {k: rec[k] for k in ("url", "status", "ms", "bytes", "wire_bytes", "headers") if k in rec}


def mode_host(client):
    host = BASE.split("//")[1]
    infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    OUT["resolved"] = sorted({i[4][0] for i in infos})
    try:
        OUT["cname"] = socket.gethostbyname_ex(host)[:2]
    except Exception as e:
        OUT["cname"] = repr(e)
    status = [call(client, "", base=BASE + "/") for _ in range(6)]
    OUT["status_calls"] = [brief(r) for r in status]
    OUT["status_body"] = status[0].get("json") or status[0].get("text")
    info = call(client, "info", base=BASE + "/")
    OUT["info_call"] = brief(info)
    OUT["info_body"] = info.get("json") or info.get("text")
    obd = [call(client, "orderBookDetails", {"filter": "perp"}) for _ in range(3)]
    OUT["obd_calls"] = [brief(r) for r in obd]
    gz = client.get(API + "orderBookDetails", params={"filter": "perp"}, headers={"accept-encoding": "identity"})
    OUT["obd_identity"] = {"status": gz.status_code, "content-encoding": gz.headers.get("content-encoding"),
                           "content-length": gz.headers.get("content-length"), "bytes": len(gz.content)}
    _last[0] = time.monotonic()
    print(json.dumps({k: OUT[k] for k in ("resolved", "cname", "status_body", "info_body", "obd_identity")}, indent=1))
    for r in OUT["status_calls"] + [OUT["info_call"]] + OUT["obd_calls"]:
        print(r["status"], r["ms"], "ms", r["bytes"], "B", r["wire_bytes"], "wire", r["url"])
    print(json.dumps(OUT["status_calls"][0]["headers"], indent=1))
    print(json.dumps(OUT["obd_calls"][0]["headers"], indent=1))


def summarise_rows(rows):
    s = {"count": len(rows)}
    for key in ("market_type", "status", "quote_multiplier", "multiplier", "size_decimals", "price_decimals",
                "taker_fee", "maker_fee", "is_taker_fee_enabled", "is_maker_fee_enabled", "liquidation_fee",
                "funding_premium_multiplier", "funding_clamp_small", "funding_clamp_big", "base_interest_rate",
                "market_flags", "strategy_index", "quote_asset_id"):
        s[key] = dict(collections.Counter(str(r.get(key)) for r in rows).most_common(12))
    for key in ("hidden", "trading_hours", "market_margin_mode", "force_reduce_only", "liquidation_mode",
                "funding_fee_discounts_enabled", "rfq_enabled"):
        s["market_config." + key] = dict(collections.Counter(str((r.get("market_config") or {}).get(key)) for r in rows).most_common(8))
    s["fields"] = sorted({k for r in rows for k in r})
    syms = [r.get("symbol") for r in rows]
    s["duplicate_symbols"] = [k for k, v in collections.Counter(syms).items() if v > 1]
    s["non_ascii_or_odd"] = [x for x in syms if not x or not x.isascii() or not x.replace("_", "").replace("-", "").isalnum()]
    s["zero_or_missing_mark"] = [r.get("symbol") for r in rows if r.get("market_type") == "perp" and not float(r.get("mark_price") or 0)]
    s["zero_or_missing_index"] = [r.get("symbol") for r in rows if r.get("market_type") == "perp" and not float(r.get("index_price") or 0)]
    return s


def mode_catalog(client):
    allr = call(client, "orderBookDetails")
    perp = call(client, "orderBookDetails", {"filter": "perp"})
    (WORK / f"orderBookDetails-{LABEL}.json").write_text(json.dumps(allr.get("json"), indent=1))
    js = allr["json"]
    OUT["all_call"] = brief(allr)
    OUT["perp_call"] = brief(perp)
    OUT["top_keys"] = sorted(js.keys())
    perps = js.get("order_book_details") or []
    spots = js.get("spot_order_book_details") or []
    OUT["perps"] = summarise_rows(perps)
    OUT["spots"] = summarise_rows(spots)
    OUT["perp_filter_counts"] = {k: len(v) for k, v in perp["json"].items() if isinstance(v, list)}
    active = [r for r in perps if r.get("status") == "active"]
    OUT["active_perps"] = summarise_rows(active)
    OUT["inactive_perps"] = [(r["market_id"], r["symbol"], r["status"]) for r in perps if r.get("status") != "active"]
    OUT["hidden_active"] = [(r["market_id"], r["symbol"]) for r in active if (r.get("market_config") or {}).get("hidden")]
    OUT["trading_hours_active"] = [(r["market_id"], r["symbol"], (r.get("market_config") or {}).get("trading_hours")) for r in active if (r.get("market_config") or {}).get("trading_hours")]
    OUT["scaled_names"] = [(r["market_id"], r["symbol"], r.get("quote_multiplier"), r.get("multiplier"), r.get("last_trade_price")) for r in perps
                           if r["symbol"][:1] in "k1" or str(r.get("quote_multiplier")) not in ("1", "1.0") or str(r.get("multiplier")) not in ("1", "1.000000000000000000")]
    OUT["fpm_not_100"] = [(r["market_id"], r["symbol"], r.get("funding_premium_multiplier")) for r in active if str(r.get("funding_premium_multiplier")) != "100"]
    OUT["id_range"] = [min(r["market_id"] for r in perps), max(r["market_id"] for r in perps)] if perps else None
    OUT["sample_perp"] = next((r for r in perps if r.get("symbol") == "BTC"), perps[0] if perps else None)
    OUT["sample_spot"] = spots[0] if spots else None
    OUT["active_symbols"] = [(r["market_id"], r["symbol"]) for r in active]
    print(json.dumps({k: OUT[k] for k in ("all_call", "perp_call", "top_keys", "perp_filter_counts", "inactive_perps",
                                          "hidden_active", "trading_hours_active", "scaled_names", "fpm_not_100", "id_range")}, indent=1, default=str))
    print("perps", json.dumps(OUT["perps"], indent=1))
    print("active", json.dumps(OUT["active_perps"], indent=1))
    print("spots", json.dumps({k: OUT["spots"][k] for k in ("count", "status", "market_type")}, indent=1))
    print("sample_perp", json.dumps(OUT["sample_perp"], indent=1))


def mode_oracle(client):
    r = call(client, "priceOracleInfo")
    (WORK / f"priceOracleInfo-{LABEL}.json").write_text(json.dumps(r.get("json"), indent=1))
    js = r.get("json") or {}
    OUT["call"] = brief(r)
    OUT["computed_at_ms"] = js.get("computed_at_ms")
    OUT["age_at_arrival_ms"] = r["local_ms"] - js.get("computed_at_ms", 0) if js.get("computed_at_ms") else None
    mk = js.get("markets") or []
    OUT["markets"] = len(mk)
    for leg in ("index", "mark"):
        rows = [m.get(leg) or {} for m in mk]
        OUT[leg] = {
            "source": dict(collections.Counter(str(x.get("source")) for x in rows).most_common()),
            "using_median": dict(collections.Counter(str(x.get("using_median")) for x in rows)),
            "using_internal_price": dict(collections.Counter(str(x.get("using_internal_price")) for x in rows)),
            "median_sources": dict(collections.Counter(",".join(sorted(x.get("median_sources") or [])) for x in rows).most_common(15)),
            "price_cap_bps": dict(collections.Counter(str(x.get("price_cap_bps")) for x in rows).most_common(10)),
            "internal_symbols": [m["symbol"] for m in mk if (m.get(leg) or {}).get("using_internal_price")],
        }
    OUT["examples"] = {m["symbol"]: m for m in mk if m.get("symbol") in ("BTC", "ETH", "XAU", "SPY", "NVDA", "HYPE", "LIT")}
    print(json.dumps(OUT, indent=1, default=str))


def mode_anchor(client):
    polls = []
    start = time.monotonic()
    for i in range(20):
        wait = start + 3.0 * i - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        r = call(client, "orderBookDetails", {"filter": "perp"})
        rows = {x["symbol"]: x for x in (r.get("json") or {}).get("order_book_details", []) if x.get("status") == "active"}
        polls.append({"local_ms": r["local_ms"], "ms": r["ms"], "bytes": r["bytes"],
                      "x_cache": r["headers"].get("x-cache"), "age": r["headers"].get("age"), "date": r["headers"].get("date"),
                      "rows": {s: (x.get("index_price"), x.get("mark_price"), x.get("last_trade_price"), x.get("open_interest")) for s, x in rows.items()}})
    OUT["poll_ms"] = [p["ms"] for p in polls]
    OUT["poll_bytes"] = [p["bytes"] for p in polls]
    OUT["poll_cache"] = [(p["x_cache"], p["age"], p["date"]) for p in polls]
    OUT["identical_to_previous_poll"] = sum(1 for a, b in zip(polls, polls[1:]) if a["rows"] == b["rows"])
    busted = []
    for i in range(3):
        r = call(client, "orderBookDetails", {"filter": "perp", "_": str(int(time.time() * 1000))})
        busted.append({"status": r["status"], "ms": r["ms"], "x_cache": r["headers"].get("x-cache"), "age": r["headers"].get("age"),
                       "rows": len((r.get("json") or {}).get("order_book_details", []))})
    OUT["cache_buster_polls"] = busted
    syms = sorted(set.intersection(*[set(p["rows"]) for p in polls]))
    changes = {}
    for s in syms:
        seq = [p["rows"][s] for p in polls]
        ch = [sum(1 for a, b in zip(seq, seq[1:]) if a[k] != b[k]) for k in range(4)]
        changes[s] = {"index": ch[0], "mark": ch[1], "last": ch[2], "oi": ch[3],
                      "mark_eq_index_polls": sum(1 for x in seq if x[0] == x[1])}
    OUT["transitions"] = len(polls) - 1
    OUT["markets_tracked"] = len(syms)
    agg = {k: statistics.median(c[k] for c in changes.values()) for k in ("index", "mark", "last", "oi")}
    OUT["median_changes"] = agg
    OUT["never_changed"] = {k: sum(1 for c in changes.values() if c[k] == 0) for k in ("index", "mark")}
    OUT["examples"] = {s: changes[s] for s in ("BTC", "ETH", "SOL", "HYPE", "XAU", "SPY", "NVDA") if s in changes}
    OUT["mark_eq_index_all_polls"] = [s for s, c in changes.items() if c["mark_eq_index_polls"] == len(polls)]
    fr = call(client, "funding-rates")
    rows = (fr.get("json") or {}).get("funding_rates", [])
    OUT["funding_rates_call"] = brief(fr)
    OUT["funding_rates_by_exchange"] = dict(collections.Counter(x.get("exchange") for x in rows))
    OUT["funding_rates_examples"] = [x for x in rows if x.get("symbol") in ("BTC", "ETH")]
    now = int(time.time())
    for mid in (1, 0):
        f = call(client, "fundings", {"market_id": mid, "resolution": "1h", "start_timestamp": now - 26 * 3600,
                                     "end_timestamp": now, "count_back": 0})
        OUT[f"fundings_{mid}_call"] = brief(f)
        OUT[f"fundings_{mid}"] = f.get("json")
    print(json.dumps({k: v for k, v in OUT.items() if not k.startswith("fundings_")}, indent=1, default=str))
    for mid in (1, 0):
        js = OUT[f"fundings_{mid}"] or {}
        fl = js.get("fundings") or []
        print("fundings", mid, "rows", len(fl), "keys", sorted(fl[0].keys()) if fl else None)
        for x in fl[-4:]:
            print(" ", x)


def mode_book(client):
    res = {}
    for mid, lim in ((1, 100), (1, 250), (0, 20)):
        r = call(client, "orderBookOrders", {"market_id": mid, "limit": lim})
        js = r.get("json") or {}
        bids, asks = js.get("bids") or [], js.get("asks") or []
        bp = [float(x["price"]) for x in bids]
        ap = [float(x["price"]) for x in asks]
        res[f"{mid}_{lim}"] = {
            "call": brief(r), "code": js.get("code"), "total_bids": js.get("total_bids"), "total_asks": js.get("total_asks"),
            "n_bids": len(bids), "n_asks": len(asks), "unique_bid_prices": len(set(bp)), "unique_ask_prices": len(set(ap)),
            "bids_desc": bp == sorted(bp, reverse=True), "asks_asc": ap == sorted(ap),
            "best_bid": bp[:1], "best_ask": ap[:1], "keys": sorted(bids[0].keys()) if bids else None,
            "first_bid": bids[:1], "message": js.get("message"),
        }
        if r.get("text"):
            res[f"{mid}_{lim}"]["text"] = r["text"]
    a = call(client, "orderBookOrders", {"market_id": 1, "limit": 20})
    b = call(client, "orderBookOrders", {"market_id": 1, "limit": 20})
    res["repeat_same"] = a.get("json") == b.get("json")
    res["repeat_headers"] = [a["headers"], b["headers"]]
    ob = call(client, "orderBooks")
    rows = (ob.get("json") or {}).get("order_books") or []
    res["orderBooks"] = {"call": brief(ob), "rows": len(rows), "keys": sorted(rows[0].keys()) if rows else None, "first": rows[:1]}
    es = call(client, "exchangeStats")
    js = es.get("json") or {}
    res["exchangeStats"] = {"call": brief(es), "keys": sorted(js.keys()),
                            "first": (js.get("order_book_stats") or [None])[:1]}
    OUT.update(res)
    print(json.dumps(res, indent=1, default=str))


def mode_errors(client):
    cases = [
        ("orderBookDetails", {"market_id": 9999}, "GET"),
        ("orderBookDetails", {"market_id": "abc"}, "GET"),
        ("orderBookOrders", {"market_id": 9999, "limit": 10}, "GET"),
        ("orderBookOrders", {"market_id": 1}, "GET"),
        ("orderBookOrders", {"market_id": 1, "limit": 1000}, "GET"),
        ("nope", None, "GET"),
        ("orderBookDetails", None, "POST"),
        ("priceOracleInfo", {"symbol": "NOPE"}, "GET"),
    ]
    res = []
    refusals = 0
    for path, params, method in cases:
        r = call(client, path, params, method, record_refusal=True)
        res.append({"path": path, "params": params, "method": method, "status": r["status"], "x-cache": r["headers"].get("x-cache"),
                    "content-type": r["headers"].get("content-type"), "body": r.get("json") if "json" in r else r.get("text")})
        refusals = refusals + 1 if r["status"] in (403, 418, 429) else 0
        if refusals >= 2:
            print("two refusals in a row, stopping")
            break
    OUT["errors"] = res
    for x in res:
        print(json.dumps(x, default=str)[:600])


def mode_time(client):
    rows = []
    for _ in range(5):
        pace()
        _last[0] -= PACE_S
        t0 = time.time()
        r = call(client, "", base=BASE + "/")
        t1 = time.time()
        js = r.get("json") or {}
        ts = js.get("timestamp")
        rows.append({"rtt_ms": round((t1 - t0) * 1000, 1), "server": ts, "local_send": round(t0, 3), "local_recv": round(t1, 3),
                     "offset_s_mid": round((t0 + t1) / 2 - float(ts), 3) if ts else None, "date": r["headers"].get("date")})
    OUT["time"] = rows
    print(json.dumps(rows, indent=1))


MODE = sys.argv[1] if len(sys.argv) > 1 else "host"
LABEL = sys.argv[2] if len(sys.argv) > 2 else time.strftime("%H%M", time.gmtime())

if __name__ == "__main__":
    OUT["mode"] = MODE
    OUT["started_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with httpx.Client(headers={"user-agent": UA, "accept": "application/json"}, timeout=20, http2=False) as client:
        {"host": mode_host, "catalog": mode_catalog, "oracle": mode_oracle, "anchor": mode_anchor,
         "book": mode_book, "errors": mode_errors, "time": mode_time}[MODE](client)
    OUT["ended_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    save()
