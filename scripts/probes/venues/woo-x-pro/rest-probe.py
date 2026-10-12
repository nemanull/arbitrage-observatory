# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""WOO X Pro public futures REST probe.

Public, unauthenticated and read-only, and every call stays far under the documented 12 requests per 2 s per endpoint.
Run from the repository root: uv run scripts/probes/venues/woo-x-pro/rest-probe.py <mode>

  host      DNS answers and cold and warm request time for the catalog, about 5 s
  catalog   counts by status, quote and funding interval, contract sizes, TradFi rows, pairs listed twice, about 2 s
  live      one depth call per live contract (Trading with 24 h volume), book sides and mid against the index, about 60 s
  anchor    the catalog polled once a second for 60 s and how often each anchor field changes, then funding-rate, funding history and the mark kline for two contracts, about 70 s
  book      REST depth for BTCUSDT: level count, order, the third column, repeated reads, about 5 s
  errors    unknown symbol, missing parameter, unknown route, bad kline step, about 3 s
  time      server time route and clock offset from the Date header, about 3 s
  frozen    the OpenAPI depth and last trades against the web front end's own market host, on six contracts, about 10 s
  funding   which funding number is which: catalog, funding-rate, history and the web front end, on eight contracts, about 15 s
  identity  WOO X Pro against BitMart: the BitMart host, CoinGecko's BitMart futures BTC ticker, about 10 s

Set PROBE_OUT_DIR to keep raw replies.
Recorded in docs/profiles/woo-x-pro/rest.md.
"""

import collections
import email.utils
import json
import os
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request

API = "https://cloud-api.wooxpro.com"
OUT = os.environ.get("PROBE_OUT_DIR")
UA = {"User-Agent": "arbitrage-observatory-probe/1.0"}


def log(tag, **fields):
    print(json.dumps({"tag": tag, **fields}, default=str))


def keep(name, text):
    if OUT:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name), "w") as f:
            f.write(text)


def get(url):
    if url.startswith("/"):
        url = API + url
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20) as r:
            status, headers, body = r.status, {k.lower(): v for k, v in r.headers.items()}, r.read()
    except urllib.error.HTTPError as e:
        status, headers, body = e.code, {k.lower(): v for k, v in e.headers.items()}, e.read()
    except urllib.error.URLError as e:
        return {"status": None, "ms": None, "error": str(e.reason), "text": "", "json": None, "headers": {}}
    ms = round((time.perf_counter() - t0) * 1000)
    text = body.decode("utf-8", "replace")
    try:
        parsed = json.loads(text)
    except ValueError:
        parsed = None
    return {"status": status, "ms": ms, "bytes": len(body), "text": text, "json": parsed, "headers": headers}


def catalog_rows():
    r = get("/contract/public/details")
    return r, (r["json"] or {}).get("data", {}).get("symbols", [])


def live_rows(rows):
    return [m for m in rows if m["status"] == "Trading" and float(m["volume_24h"]) > 0]


def host():
    for name in ["cloud-api.wooxpro.com", "cloud-ws.wooxpro.com"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443)})
        except OSError as e:
            addrs = [str(e)]
        log("dns", host=name, addresses=addrs)
    for i in range(4):
        r = get("/contract/public/details?symbol=BTCUSDT")
        log("small_call", i=i, status=r["status"], ms=r["ms"], cf_ray=r["headers"].get("cf-ray"), via=r["headers"].get("via"))
        time.sleep(0.5)
    for i in range(3):
        r = get("/contract/public/details")
        log("catalog_call", i=i, status=r["status"], ms=r["ms"], bytes=r["bytes"], code=(r["json"] or {}).get("code"))
        time.sleep(0.5)


def catalog():
    r, rows = catalog_rows()
    keep("details.json", r["text"])
    log("catalog", status=r["status"], ms=r["ms"], bytes=r["bytes"], rows=len(rows))
    groups = collections.Counter(f'{m["product_type"]}/{m["status"]}/{m["quote_currency"]}/{m["funding_interval_hours"]}h' for m in rows)
    log("groups", groups=dict(sorted(groups.items())))
    trading = [m for m in rows if m["status"] == "Trading"]
    live = live_rows(rows)
    log("trading", total=len(trading), by_quote=dict(collections.Counter(m["quote_currency"] for m in trading)),
        live=len(live), live_by_quote=dict(collections.Counter(m["quote_currency"] for m in live)))
    log("contract_sizes_trading", sizes=dict(collections.Counter(m["contract_size"] for m in trading)))
    log("fields", keys=sorted({k for m in rows for k in m}))
    log("has_mark_field", any_mark=any("mark_price" in m for m in rows))
    tradfi = [m for m in trading if m.get("tradfi_info")]
    log("tradfi_trading", count=len(tradfi), live=sum(1 for m in tradfi if m in live),
        session_status=dict(collections.Counter(m["tradfi_info"].get("market_session_status") for m in tradfi)))
    now = time.time()
    log("delist_markers", trading_with_delist_time=sum(1 for m in trading if m["delist_time"]),
        in_past=sum(1 for m in trading if m["delist_time"] and m["delist_time"] < now))
    bases = collections.defaultdict(list)
    for m in trading:
        bases[m["base_currency"]].append(m["symbol"])
    log("bases_listed_twice", pairs={b: s for b, s in bases.items() if len(s) > 1})
    log("non_usdt_trading", symbols=[(m["symbol"], m["quote_currency"], m["contract_size"], m["volume_24h"]) for m in trading if m["quote_currency"] != "USDT"])
    for sym in ["BTCUSDT", "ETHUSDT", "BTCUSD", "BTCUSDC", "1000PEPEUSDT"]:
        m = next((x for x in rows if x["symbol"] == sym), None)
        if m:
            log("row", **{k: m[k] for k in ["symbol", "status", "contract_size", "last_price", "index_price", "funding_rate",
                                             "expected_funding_rate", "funding_time", "funding_interval_hours", "volume_24h", "turnover_24h"]})
    log("turnover", live_sum_usd=round(sum(float(m["turnover_24h"]) for m in live)),
        top10=[(m["symbol"], round(float(m["turnover_24h"]))) for m in sorted(live, key=lambda x: -float(x["turnover_24h"]))[:10]])


def live():
    _, rows = catalog_rows()
    out = []
    for m in live_rows(rows):
        d = get(f'/contract/public/depth?symbol={m["symbol"]}')
        data = (d["json"] or {}).get("data") or {}
        bids, asks = data.get("bids") or [], data.get("asks") or []
        idx = float(m["index_price"])
        mid = (float(bids[0][0]) + float(asks[0][0])) / 2 if bids and asks else None
        out.append({"symbol": m["symbol"], "bids": len(bids), "asks": len(asks),
                    "mid_vs_index_ppm": round((mid - idx) / idx * 1e6) if mid and idx else None, "ms": d["ms"]})
        time.sleep(0.25)
    keep("live.json", json.dumps(out, indent=1))
    two = [r for r in out if r["bids"] and r["asks"]]
    far = [r["symbol"] for r in two if abs(r["mid_vs_index_ppm"]) > 10_000]
    log("live_summary", contracts=len(out), two_sided=len(two), one_or_no_side=[r["symbol"] for r in out if not (r["bids"] and r["asks"])],
        levels_min=min((min(r["bids"], r["asks"]) for r in two), default=None),
        mid_vs_index_ppm_median=statistics.median(abs(r["mid_vs_index_ppm"]) for r in two) if two else None,
        mid_more_than_1pct_from_index=far, mid_within_1pct_of_index=[r["symbol"] for r in two if r["symbol"] not in far], depth_ms_median=statistics.median(r["ms"] for r in out))


def anchor():
    prev, changes, times, polls, fails = {}, {}, [], 0, 0
    fields = ["index_price", "funding_rate", "expected_funding_rate", "funding_time", "last_price"]
    t0 = time.time()
    while time.time() - t0 < 60:
        tick = time.time()
        r, rows = catalog_rows()
        polls += 1
        times.append(r["ms"])
        if not rows:
            fails += 1
            log("poll_fail", status=r["status"], body=r["text"][:120])
        for m in live_rows(rows):
            cur = {k: m[k] for k in fields}
            c = changes.setdefault(m["symbol"], dict.fromkeys(fields, 0))
            p = prev.get(m["symbol"])
            if p:
                for k in fields:
                    c[k] += p[k] != cur[k]
            prev[m["symbol"]] = cur
        time.sleep(max(0, 1 - (time.time() - tick)))
    log("anchor_polls", polls=polls, fails=fails, ms_min=min(times), ms_median=statistics.median(times), ms_max=max(times))
    for k in fields:
        vals = sorted(c[k] for c in changes.values())
        log("changes_over_live", field=k, contracts=len(vals), median=statistics.median(vals), min=vals[0], max=vals[-1])
    for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT"]:
        log("changes", symbol=sym, **changes.get(sym, {}), last=prev.get(sym))
    for sym in ["BTCUSDT", "ETHUSDT"]:
        f = get(f"/contract/public/funding-rate?symbol={sym}")
        log("funding_rate", symbol=sym, status=f["status"], ms=f["ms"], data=(f["json"] or {}).get("data"))
        h = get(f"/contract/public/funding-rate-history?symbol={sym}&limit=4")
        log("funding_history", symbol=sym, rows=((h["json"] or {}).get("data") or {}).get("list"))
        now = int(time.time())
        k = get(f"/contract/public/markprice-kline?symbol={sym}&step=1&start_time={now - 180}&end_time={now}")
        log("mark_kline", symbol=sym, status=k["status"], ms=k["ms"], last=((k["json"] or {}).get("data") or [])[-1:])
        log("catalog_row", symbol=sym, **(prev.get(sym) or {}))
        time.sleep(0.5)
    r = get("/contract/public/funding-rate-v2")
    log("funding_rate_v2", status=r["status"], ms=r["ms"], bytes=r.get("bytes"), body=r["text"][:300])


def book():
    for i in range(3):
        r = get("/contract/public/depth?symbol=BTCUSDT")
        d = (r["json"] or {}).get("data") or {}
        bids, asks = d.get("bids") or [], d.get("asks") or []
        log("depth", i=i, status=r["status"], ms=r["ms"], bids=len(bids), asks=len(asks), timestamp=d.get("timestamp"),
            age_ms=int(time.time() * 1000) - d.get("timestamp", 0), bids_head=bids[:3], asks_head=asks[:3],
            bids_descending=all(float(bids[j][0]) > float(bids[j + 1][0]) for j in range(len(bids) - 1)),
            asks_ascending=all(float(asks[j][0]) < float(asks[j + 1][0]) for j in range(len(asks) - 1)),
            cache=r["headers"].get("cf-cache-status"))
        if i == 0:
            keep("depth-BTCUSDT.json", r["text"])
        time.sleep(1)
    r = get("/contract/public/depth?symbol=BTCUSDT&limit=5")
    d = (r["json"] or {}).get("data") or {}
    log("depth_limit_param", status=r["status"], bids=len(d.get("bids") or []), asks=len(d.get("asks") or []))


def errors():
    for path in ["/contract/public/depth?symbol=NOPEUSDT", "/contract/public/depth", "/contract/public/funding-rate?symbol=NOPEUSDT",
                 "/contract/public/details?symbol=NOPEUSDT", "/contract/public/nothing", "/spot/v1/symbols",
                 "/contract/public/markprice-kline?symbol=BTCUSDT&step=2&start_time=1&end_time=2"]:
        r = get(path)
        log("error_case", path=path, status=r["status"], ms=r["ms"], retry_after=r["headers"].get("retry-after"), body=r["text"][:200])
        time.sleep(0.3)


def server_time():
    for path in ["/system/time", "/contract/public/time"]:
        r = get(path)
        log("time_route", path=path, status=r["status"], body=r["text"][:160])
    for i in range(3):
        t_send = time.time()
        r = get("/contract/public/depth?symbol=BTCUSDT")
        t_recv = time.time()
        date = email.utils.parsedate_to_datetime(r["headers"]["date"]).timestamp()
        ts = ((r["json"] or {}).get("data") or {}).get("timestamp")
        log("clock", i=i, date_header_offset_s=round(date - (t_send + t_recv) / 2, 2),
            depth_timestamp_minus_local_ms=round(ts - (t_send + t_recv) / 2 * 1000) if ts else None, rtt_ms=round((t_recv - t_send) * 1000))
        time.sleep(0.5)


FRONT = "https://contract-v2.wooxpro.com"  # the host derivatives.wooxpro.com's own bundle builds as contract-v2.<hostname>


def frozen():
    _, rows = catalog_rows()
    now = time.time()
    meta = get("https://derivatives.wooxpro.com/gw-api/coincenter-business/contracts")
    ids = {c["contract"]["name"]: c["contract"]["contract_id"] for c in ((meta["json"] or {}).get("data") or {}).get("contracts", [])}
    log("front_contracts", status=meta["status"], count=len(ids))
    for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "BTCUSD", "BTCUSDC"]:
        m = next(x for x in rows if x["symbol"] == sym)
        d = ((get(f"/contract/public/depth?symbol={sym}")["json"] or {}).get("data")) or {}
        t = (get(f"/contract/public/market-trade?symbol={sym}&limit=1")["json"] or {}).get("data") or []
        cid = ids.get(sym)
        fd = ((get(f"{FRONT}/v1/ifcontract/depth?contractID={cid}&count=5")["json"] or {}).get("data")) or {}
        ft = (((get(f"{FRONT}/v1/ifcontract/trades?contractID={cid}&size=1")["json"] or {}).get("data")) or {}).get("trades") or []
        bids, asks = d.get("bids") or [], d.get("asks") or []
        log("frozen", symbol=sym, index=m["index_price"], catalog_last=m["last_price"],
            openapi_best_bid=bids[0][0] if bids else None, openapi_best_ask=asks[0][0] if asks else None, openapi_bid_levels=len(bids), openapi_ask_levels=len(asks),
            openapi_last_trade_age_h=round((now - t[0]["time"]) / 3600, 1) if t else None, openapi_last_trade_price=t[0]["price"] if t else None,
            front_contract_id=cid, front_best_bid=(fd.get("buys") or [{}])[0].get("price"), front_best_ask=(fd.get("sells") or [{}])[0].get("price"),
            front_last_trade_age_s=round(now - ft[0]["create_time"]) if ft else None, front_last_trade_price=ft[0]["deal_price"] if ft else None)
        time.sleep(0.5)


def funding():
    _, rows = catalog_rows()
    meta = get("https://derivatives.wooxpro.com/gw-api/coincenter-business/contracts")
    ids = {c["contract"]["name"]: c["contract"]["contract_id"] for c in ((meta["json"] or {}).get("data") or {}).get("contracts", [])}
    for sym in ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "XRPUSDT", "SUIUSDT", "BTCUSD", "BTCUSDC"]:
        m = next(x for x in rows if x["symbol"] == sym)
        f = ((get(f"/contract/public/funding-rate?symbol={sym}")["json"] or {}).get("data")) or {}
        h = (((get(f"/contract/public/funding-rate-history?symbol={sym}&limit=100")["json"] or {}).get("data")) or {}).get("list") or []
        t = ((((get(f"{FRONT}/v1/ifcontract/tickers?contractID={ids.get(sym)}")["json"] or {}).get("data")) or {}).get("tickers") or [{}])[0]
        log("funding", symbol=sym, catalog_funding_rate=m["funding_rate"], catalog_expected=m["expected_funding_rate"],
            catalog_funding_time=m["funding_time"], interval_h=m["funding_interval_hours"],
            endpoint_rate_value=f.get("rate_value"), endpoint_expected=f.get("expected_rate"), endpoint_funding_time=f.get("funding_time"),
            history_last=(h[0]["funding_time"], h[0]["funding_rate"]) if h else None,
            catalog_funding_rate_in_history=[x["funding_time"] for x in h if float(x["funding_rate"]) == float(m["funding_rate"])],
            front_funding_rate=t.get("funding_rate"), front_next_funding_at=t.get("next_funding_at"))
        time.sleep(0.6)


def identity():
    for name in ["api-cloud-v2.bitmart.com", "openapi-ws-v2.bitmart.com"]:
        try:
            addrs = sorted({a[4][0] for a in socket.getaddrinfo(name, 443)})
        except OSError as e:
            addrs = ["resolve failed: " + str(e)]
        log("bitmart_dns", host=name, addresses=addrs)
    r = get("https://api-cloud-v2.bitmart.com/contract/public/details?symbol=BTCUSDT")
    log("bitmart_details", status=r["status"], error=r.get("error"), body=r["text"][:200])
    w = get("/contract/public/details?symbol=BTCUSDT")
    wm = w["json"]["data"]["symbols"][0]
    log("wooxpro_btc", **{k: wm[k] for k in ["open_timestamp", "last_price", "volume_24h", "open_interest", "contract_size", "funding_rate"]})
    for attempt in range(3):
        g = get("https://api.coingecko.com/api/v3/derivatives/exchanges/bitmart_futures?include_tickers=unexpired")
        if g["status"] == 200:
            t = next((x for x in g["json"].get("tickers", []) if x.get("symbol") == "BTCUSDT"), None)
            log("coingecko_bitmart_btcusdt", ticker=t)
            if t:
                oi_btc = float(wm["open_interest"]) * float(wm["contract_size"])
                log("compare", wooxpro_last=wm["last_price"], coingecko_bitmart_last=t.get("last"),
                    wooxpro_open_interest_btc=round(oi_btc, 3), coingecko_bitmart_open_interest_usd=t.get("open_interest_usd"),
                    wooxpro_open_interest_usd=round(oi_btc * float(wm["last_price"])), coingecko_last_traded=t.get("last_traded_at"))
            break
        log("coingecko_retry", status=g["status"])
        time.sleep(4)
    g = get("https://api.coingecko.com/api/v3/derivatives/exchanges/list")
    if g["status"] == 200:
        log("coingecko_derivative_exchanges", matches=[x for x in g["json"] if "woo" in x["id"] or "bitmart" in x["id"] or "nova" in x["id"]])


MODES = {"host": host, "catalog": catalog, "live": live, "anchor": anchor, "book": book, "errors": errors, "time": server_time, "frozen": frozen, "funding": funding, "identity": identity}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "catalog"
    log("run", mode=mode, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    MODES[mode]()
