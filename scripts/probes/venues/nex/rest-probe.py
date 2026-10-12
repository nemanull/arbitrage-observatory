# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""NEX Exchange REST probe for docs/profiles/nex/rest.md.

Public, unauthenticated and read-only, standard library only.
NEX publishes no API documentation.
Every call below is one the n-exchange.io web bundle makes, on the hosts api.allinpro.com and user.allinpro.com.
About 80 requests in roughly 75 s, at most two per second, in these sections:
  hosts    DNS and cold and warm request time per host.
  spot     the spot ticker list, which is the only spot catalog, and the spot REST book.
  futures  the futures market list, the state call that carries index, mark and funding, the REST book and last trades per market.
  poll     30 one-second polls of the state call, counting how often each anchor field changes.
  compare  the futures index against NEX spot and Kraken spot for the same five bases.
  errors   unknown symbols and missing parameters.
  time     server clock fields against the local clock.
Run from the repository root with: uv run scripts/probes/venues/nex/rest-probe.py
Captures land in .claude/survey-work/nex/.
"""

import json
import pathlib
import socket
import statistics
import time
import urllib.error
import urllib.request

API = "https://api.allinpro.com"
FUT = API + "/futures"
USER = "https://user.allinpro.com"
ROOT = pathlib.Path(__file__).resolve().parents[4]
WORK = ROOT / ".claude" / "survey-work" / "nex"
WORK.mkdir(parents=True, exist_ok=True)
UA = "Mozilla/5.0 (arbitrage-observatory-probe/1.0)"
OUT = {}
KEEP_HEADERS = ("server", "date", "cache-control", "age", "x-cache", "retry-after", "content-encoding", "via")


def get(url, raw=False):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Origin": "https://n-exchange.io", "Accept-Encoding": "identity"})
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read()
            status = r.status
            hdrs = {k.lower(): v for k, v in r.headers.items()}
    except urllib.error.HTTPError as e:
        body = e.read()
        status = e.code
        hdrs = {k.lower(): v for k, v in e.headers.items()}
    ms = round((time.perf_counter() - t0) * 1000, 1)
    out = {"status": status, "ms": ms, "bytes": len(body),
           "headers": {k: v for k, v in hdrs.items() if k in KEEP_HEADERS or "limit" in k}}
    if raw:
        out["text"] = body[:300].decode("utf-8", "replace")
        return out, None
    try:
        return out, json.loads(body)
    except ValueError:
        out["text"] = body[:300].decode("utf-8", "replace")
        return out, None


def hosts():
    res = {}
    for host, path in (("n-exchange.io", "https://n-exchange.io/robots.txt"),
                       ("api.allinpro.com", FUT + "/web/api/v1/market/list"),
                       ("user.allinpro.com", USER + "/v2/common/futures/tickers/recommend"),
                       ("ws.allinpro.com", None)):
        addrs = sorted({a[4][0] for a in socket.getaddrinfo(host, 443, socket.AF_INET)})
        row = {"ipv4": addrs}
        if path:
            times = []
            for _ in range(4):
                meta, _ = get(path, raw=True)
                times.append(meta["ms"])
                time.sleep(0.5)
            row["cold_ms"] = times[0]
            row["warm_ms_median"] = statistics.median(times[1:])
            row["last_status"] = meta["status"]
            row["headers"] = meta["headers"]
        res[host] = row
    robots, _ = get("https://n-exchange.io/robots.txt", raw=True)
    res["robots_txt"] = robots["text"]
    return res


def spot():
    meta, d = get(API + "/api/spot/tickers")
    tickers = d["data"]["tickers"]
    (WORK / "rest-spot-tickers.json").write_text(json.dumps(d))
    quotes = {}
    for t in tickers:
        quotes[t["frm"]] = quotes.get(t["frm"], 0) + 1
    res = {"meta": meta, "count": len(tickers), "by_quote": quotes, "symbols": [t["symbol"] for t in tickers],
           "fields": sorted(tickers[0].keys()), "btc": {k: tickers[0].get(k) for k in ("symbol", "price", "frm_fixed", "to_fixed", "min_order_amount", "buy_min", "sell_min", "exchange_visibility")},
           "kline_points_per_ticker": len(tickers[0].get("kline") or [])}
    time.sleep(0.5)
    meta, b = get(API + "/api/spot/tickers/depth?symbol=BTC-USDT&merge=step0")
    bids, asks = b["data"]["bids"], b["data"]["asks"]
    res["book_btc"] = {"meta": meta, "bids": len(bids), "asks": len(asks), "bid_prices": [x["price"] for x in bids],
                       "ask_prices": [x["price"] for x in asks], "time": b.get("time"),
                       "bids_descending": all(float(a["price"]) >= float(c["price"]) for a, c in zip(bids, bids[1:])),
                       "asks_ascending": all(float(a["price"]) <= float(c["price"]) for a, c in zip(asks, asks[1:]))}
    for merge in ("step1", "step2"):
        time.sleep(0.5)
        meta, b2 = get(API + f"/api/spot/tickers/depth?symbol=BTC-USDT&merge={merge}")
        res[f"book_btc_{merge}"] = {"status": meta["status"], "code": b2.get("code") if b2 else None, "msg": b2.get("msg") if b2 else None,
                                    "levels": [len(b2["data"]["bids"]), len(b2["data"]["asks"])] if b2 and b2.get("data") else None}
    time.sleep(0.5)
    meta, b3 = get(API + "/api/spot/tickers/depth?symbol=BTC-USDT&merge=step0&limit=100")
    res["book_btc_limit100"] = [len(b3["data"]["bids"]), len(b3["data"]["asks"])]
    return res


def futures():
    meta, d = get(FUT + "/web/api/v1/market/list")
    (WORK / "rest-futures-list.json").write_text(json.dumps(d))
    rows = d["data"]
    res = {"list_meta": meta, "count": len(rows), "markets": []}
    for m in rows:
        res["markets"].append({k: m.get(k) for k in ("name", "type", "stock", "money", "available", "tick_size", "amount_min", "amount_prec", "maker_fee", "taker_fee", "merges")}
                              | {"max_leverage": m["leverages"][-1], "limits_rows": len(m.get("limits") or [])})
    res["list_fields"] = sorted(rows[0].keys())
    time.sleep(0.5)
    meta, s = get(FUT + "/web/api/v1/market/state/all")
    (WORK / "rest-futures-state.json").write_text(json.dumps(s))
    res["state_meta"] = meta
    res["state_fields"] = sorted(next(iter(s["data"].values())).keys())
    res["state"] = {k: {f: v.get(f) for f in ("last", "volume", "amount", "index_price", "sign_price", "funding_rate_last", "funding_rate_next", "funding_rate_predict", "funding_time", "next_funding_time", "server_time", "position_amount", "buy_total", "sell_total", "insurance")}
                    for k, v in s["data"].items()}
    nft = {v["next_funding_time"] for v in s["data"].values()}
    res["next_funding_time_utc"] = [time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(x)) for x in sorted(nft)]
    res["next_funding_mod_28800"] = sorted({x % 28800 for x in nft})
    res["books"] = {}
    res["last_trade"] = {}
    for m in rows:
        name = m["name"]
        for merge in ("0", m["merges"][-1]):
            time.sleep(0.5)
            meta, b = get(FUT + f"/web/api/v1/market/depth?market={name}&merge={merge}")
            res["books"][f"{name} merge={merge}"] = {"status": meta["status"], "bids": len(b["data"]["bids"]), "asks": len(b["data"]["asks"]),
                                                    "index_price": b["data"].get("index_price"), "sign_price": b["data"].get("sign_price"), "last": b["data"].get("last")}
        time.sleep(0.5)
        meta, t = get(FUT + f"/web/api/v1/market/deals?market={name}")
        trades = t.get("data") or []
        if trades:
            newest = max(x["time"] for x in trades)
            res["last_trade"][name] = {"count_returned": len(trades), "newest_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(newest)),
                                       "age_days": round((time.time() - newest) / 86400, 1), "newest_price": trades[0]["price"],
                                       "newest_amount": trades[0]["amount"]}
        else:
            res["last_trade"][name] = {"count_returned": 0}
    return res


def poll():
    fields = ("index_price", "sign_price", "funding_rate_next", "funding_rate_last", "funding_rate_predict", "last", "funding_time")
    prev = None
    changes = {f: 0 for f in fields}
    sizes, times = [], []
    for _ in range(30):
        t0 = time.time()
        meta, s = get(FUT + "/web/api/v1/market/state/all")
        sizes.append(meta["bytes"])
        times.append(meta["ms"])
        cur = s["data"].get("BTCUSDT", {})
        if prev:
            for f in fields:
                if cur.get(f) != prev.get(f):
                    changes[f] += 1
        prev = cur
        time.sleep(max(0, 1 - (time.time() - t0)))
    return {"polls": 30, "btc_changes": changes, "bytes_median": statistics.median(sizes), "ms_median": statistics.median(times)}


def compare():
    _, s = get(FUT + "/web/api/v1/market/state/all")
    _, sp = get(API + "/api/spot/tickers")
    spot_px = {t["symbol"]: t["price"] for t in sp["data"]["tickers"]}
    _, k = get("https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD,SOLUSD,XDGUSD")
    kr = {"BTC": k["result"]["XXBTZUSD"]["c"][0], "ETH": k["result"]["XETHZUSD"]["c"][0],
          "SOL": k["result"]["SOLUSD"]["c"][0], "DOGE": k["result"]["XDGUSD"]["c"][0]}
    res = {}
    for name, v in s["data"].items():
        base = name[:-4]
        idx = float(v["index_price"])
        nsp = float(spot_px.get(f"{base}-USDT", "nan"))
        row = {"index": v["index_price"], "mark": v["sign_price"], "last": v["last"], "nex_spot": spot_px.get(f"{base}-USDT"),
               "index_vs_nex_spot_bp": round((idx / nsp - 1) * 1e4, 1),
               "mark_vs_index_bp": round((float(v["sign_price"]) / idx - 1) * 1e4, 1),
               "last_vs_index_bp": round((float(v["last"]) / idx - 1) * 1e4, 1)}
        if base in kr:
            row["kraken_usd"] = kr[base]
            row["index_vs_kraken_bp"] = round((idx / float(kr[base]) - 1) * 1e4, 1)
        res[name] = row
    return res


def errors():
    res = {}
    for label, url in (("futures depth unknown market", FUT + "/web/api/v1/market/depth?market=FOOUSDT&merge=0"),
                       ("futures depth no market", FUT + "/web/api/v1/market/depth"),
                       ("futures deals unknown market", FUT + "/web/api/v1/market/deals?market=FOOUSDT"),
                       ("spot depth unknown symbol", API + "/api/spot/tickers/depth?symbol=FOO-USDT&merge=step0"),
                       ("spot depth no symbol", API + "/api/spot/tickers/depth"),
                       ("spot publish_status no symbol", API + "/api/spot/tickers/publish_status"),
                       ("futures unknown path", FUT + "/web/api/v1/market/funding")):
        time.sleep(0.5)
        meta, d = get(url, raw=False)
        res[label] = {"status": meta["status"], "body": json.dumps(d)[:200] if d is not None else meta.get("text", "")[:200]}
    return res


def clock():
    t_local0 = time.time()
    meta, s = get(FUT + "/web/api/v1/market/state/all")
    t_local1 = time.time()
    mid = (t_local0 + t_local1) / 2
    srv = next(iter(s["data"].values()))["server_time"]
    time.sleep(0.5)
    t0 = time.time()
    _, b = get(API + "/api/spot/tickers/depth?symbol=BTC-USDT&merge=step0")
    t1 = time.time()
    return {"futures_server_time_s": srv, "futures_offset_s": round(srv - mid, 2), "date_header": meta["headers"].get("date"),
            "spot_depth_time": b.get("time"), "spot_offset_s": round(b["time"] - (t0 + t1) / 2, 3)}


def main():
    OUT["started_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    for name, fn in (("hosts", hosts), ("spot", spot), ("futures", futures), ("poll", poll), ("compare", compare), ("errors", errors), ("time", clock)):
        try:
            OUT[name] = fn()
        except Exception as e:  # keep going so one failure does not hide the rest
            OUT[name] = {"error": repr(e)}
    (WORK / "rest-probe.json").write_text(json.dumps(OUT, indent=2))
    print(json.dumps(OUT, indent=2))


main()
