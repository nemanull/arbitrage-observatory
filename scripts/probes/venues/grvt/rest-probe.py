# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx>=0.27"]
# ///
"""Read-only REST probe for GRVT perpetuals, public market data only.

Every market data call is a POST with a JSON body to https://market-data.grvt.io/full/v1/<name>.
Nothing here signs, logs in or touches edge.grvt.io or trades.grvt.io.

Modes, all by default, or name some on the command line:
    host     DNS, one cold and ten warm ticker calls with their headers, and the docs host
             asked by httpx and by curl, each with its own user agent and with a browser user agent
    catalog  all_instruments with CCXT's empty body, with is_active, and with each kind filter
    anchor   one paced ticker sweep over every active perpetual at 8 calls a second,
             then 60 one-second polls of BTC, ETH and one thin market
    funding  funding history of BTC, ETH and one market of each other interval, and the ticker beside it
    book     the REST book of BTC at every documented depth, and at an undocumented one
    errors   an unknown instrument, a delisted one, a GET, an empty body, malformed JSON, a lite call
    binance  GRVT's funding caps and intervals against Binance USD-M fundingInfo, the K names against Binance's
             1000-coin contracts, then GRVT's index and mark beside Binance USD-M premiumIndex for six coins,
             ten samples a second apart
    collisions  every GRVT base that Binance USD-M or Bybit linear also lists, with the three marks,
             flagged where GRVT's mark is more than 2 percent from a reference, the identity check's print line

The published limit is 1,500 a minute for instrument, mini and ticker calls and 500 a minute for every other call.
The sweep runs at 480 a minute and the one-second poll at 180 a minute, so no mode reaches a third of a limit.

Run from the repository root:
    uv run scripts/probes/venues/grvt/rest-probe.py [mode ...]
"""

import json
import shutil
import socket
import subprocess
import statistics
import sys
import time
from collections import Counter

import httpx

BASE = "https://market-data.grvt.io"
DOCS = "https://api-docs.grvt.io/market_data_api/"
BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
HEADERS_KEPT = ("server", "via", "cf-ray", "cf-cache-status", "x-amz-cf-pop", "x-cache", "content-encoding",
                "content-length", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "date",
                "strict-transport-security", "x-envoy-upstream-service-time")


def out(kind, **fields):
    print(json.dumps({"kind": kind, **fields}, separators=(",", ":")), flush=True)


def post(client, name, body, lite=False):
    path = ("lite" if lite else "full") + "/v1/" + name
    t0 = time.perf_counter()
    sent_ns = time.time_ns()
    r = client.post(f"{BASE}/{path}", json=body)
    ms = (time.perf_counter() - t0) * 1000
    recv_ns = time.time_ns()
    try:
        data = r.json()
    except ValueError:
        data = None
    return r, data, ms, sent_ns, recv_ns


def kept_headers(r):
    return {k: v for k, v in r.headers.items() if k.lower() in HEADERS_KEPT}


def mode_host(client):
    infos = socket.getaddrinfo("market-data.grvt.io", 443, proto=socket.IPPROTO_TCP)
    out("dns", host="market-data.grvt.io", addresses=sorted({i[4][0] for i in infos}))
    try:
        canon = socket.gethostbyname_ex("market-data.grvt.io")
        out("dns_ex", canonical=canon[0], aliases=canon[1])
    except OSError as e:
        out("dns_ex_error", error=str(e))
    cold = httpx.Client(http2=False, timeout=10)
    r, data, ms, _, _ = post(cold, "ticker", {"instrument": "BTC_USDT_Perp"})
    out("cold", status=r.status_code, ms=round(ms, 1), bytes=len(r.content), http=r.http_version, headers=kept_headers(r))
    cold.close()
    warm = []
    for _ in range(10):
        r, data, ms, _, _ = post(client, "ticker", {"instrument": "BTC_USDT_Perp"})
        warm.append(ms)
        time.sleep(0.2)
    out("warm", status=r.status_code, ms_min=round(min(warm), 1), ms_median=round(statistics.median(warm), 1),
        ms_max=round(max(warm), 1), headers=kept_headers(r))
    # the reply only says it compressed when asked
    r = client.post(f"{BASE}/full/v1/all_instruments", json={"is_active": True}, headers={"accept-encoding": "gzip"})
    out("instruments_encoding", status=r.status_code, content_encoding=r.headers.get("content-encoding"),
        wire_bytes=r.headers.get("content-length"), json_bytes=len(r.content))
    for label, ua in (("httpx default", None), ("browser", BROWSER_UA)):
        h = {"user-agent": ua} if ua else {}
        r = httpx.get(DOCS, headers=h, timeout=10)
        title = r.text.split("<title>")[1].split("</title>")[0].strip() if "<title>" in r.text else None
        out("docs_host", client="httpx", user_agent=label, status=r.status_code, title=title, server=r.headers.get("server"),
            cf_ray=r.headers.get("cf-ray"))
    # the same page through curl, whose TLS handshake differs from httpx's
    if shutil.which("curl"):
        for label, args in (("curl default", []), ("browser", ["-A", BROWSER_UA])):
            code = subprocess.run(["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}", *args, DOCS],
                                  capture_output=True, text=True, timeout=20).stdout
            out("docs_host", client="curl", user_agent=label, status=int(code or 0))
            time.sleep(0.5)
    r = httpx.get("https://help.grvt.io/en/articles/9614699-how-does-grvt-s-fee-model-work", timeout=10)
    out("help_host", client="httpx", status=r.status_code)


def active_perps(client):
    r, data, _, _, _ = post(client, "all_instruments", {"is_active": True})
    return [i for i in data["result"] if i["kind"] == "PERPETUAL"]


def mode_catalog(client):
    bodies = [
        ("ccxt empty body", {}),
        ("is_active true", {"is_active": True}),
        ("is_active false", {"is_active": False}),
        ("kinds PERPETUAL", {"kinds": ["PERPETUAL"]}),
        ("kinds STABLE_PERP", {"kinds": ["STABLE_PERP"]}),
        ("kinds FUTURE, CALL, PUT", {"kinds": ["FUTURE", "CALL", "PUT"]}),
        ("kinds all five, is_active true", {"is_active": True, "kinds": ["PERPETUAL", "FUTURE", "CALL", "PUT", "STABLE_PERP"]}),
    ]
    results = {}
    for label, body in bodies:
        r, data, ms, _, _ = post(client, "all_instruments", body)
        rows = (data or {}).get("result") or []
        results[label] = rows
        out("all_instruments", body=label, status=r.status_code, ms=round(ms, 1), bytes=len(r.content), rows=len(rows),
            kinds=dict(Counter(x.get("kind") for x in rows)), quotes=dict(Counter(x.get("quote") for x in rows)),
            error=None if rows else (data or {}))
        time.sleep(0.3)
    everything = {x["instrument"]: x for x in results["ccxt empty body"]}
    active = {x["instrument"]: x for x in results["is_active true"]}
    inactive = sorted(set(everything) - set(active))
    out("inactive_in_ccxt_body", count=len(inactive), names=inactive,
        statuses=dict(Counter(everything[n].get("status") for n in inactive)))
    out("status_and_class", all_status=dict(Counter(x.get("status") for x in everything.values())),
        active_status=dict(Counter(x.get("status") for x in active.values())),
        active_asset_class=dict(Counter(x.get("asset_class") for x in active.values())),
        non_crypto=sorted(x["base"] for x in active.values() if x.get("asset_class") != "CRYPTO"))
    perps = [x for x in active.values() if x["kind"] == "PERPETUAL"]
    out("active_perps", count=len(perps), quotes=dict(Counter(x["quote"] for x in perps)),
        settlement_period=dict(Counter(x.get("settlement_period") for x in perps)),
        venues=dict(Counter(",".join(x.get("venues", [])) for x in perps)),
        funding_interval_hours=dict(Counter(str(x.get("funding_interval_hours")) for x in perps)),
        cap_values=dict(Counter(str(x.get("adjusted_funding_rate_cap")) for x in perps)),
        floor_values=dict(Counter(str(x.get("adjusted_funding_rate_floor")) for x in perps)),
        base_decimals=dict(Counter(str(x.get("base_decimals")) for x in perps)),
        types={k: type(v).__name__ for k, v in perps[0].items()})
    names = [x["instrument"] for x in perps]
    malformed = [n for n in names if not n.endswith("_Perp") or n.count("_") != 2]
    out("names", malformed=malformed, sample=names[:5],
        name_vs_fields=[n for n in names if n != f"{active[n]['base']}_{active[n]['quote']}_Perp"])
    bases = Counter(x["base"] for x in perps)
    out("bases_listed_twice", bases={b: c for b, c in bases.items() if c > 1})
    odd = [x["base"] for x in perps if not x["base"].isalnum() or x["base"] != x["base"].upper() or x["base"][0].isdigit()]
    out("unusual_bases", bases=odd)
    out("sample_row", row=active.get("BTC_USDT_Perp"))
    stable = results["kinds STABLE_PERP"]
    if stable:
        out("stable_perp_rows", rows=stable[:5])


def mode_anchor(client):
    perps = active_perps(client)
    names = [x["instrument"] for x in perps]
    by_name = {x["instrument"]: x for x in perps}
    rows, times, statuses, sessions, problems = {}, [], Counter(), Counter(), []
    t_start = time.perf_counter()
    for i, name in enumerate(names):
        tick = time.perf_counter()
        r, data, ms, sent_ns, recv_ns = post(client, "ticker", {"instrument": name})
        times.append(ms)
        if r.status_code != 200 or not data or "result" not in data:
            problems.append({"name": name, "status": r.status_code, "body": data})
        else:
            res = data["result"]
            rows[name] = res
            statuses[res.get("status")] += 1
            sessions[res.get("session")] += 1
            for f in ("mark_price", "index_price", "funding_rate", "next_funding_time"):
                v = res.get(f)
                if v in (None, "", "0", "0.0") or (f.endswith("price") and float(v) <= 0):
                    problems.append({"name": name, "field": f, "value": v})
        wait = 0.125 - (time.perf_counter() - tick)
        if wait > 0:
            time.sleep(wait)
    sweep_s = time.perf_counter() - t_start
    out("ticker_sweep", markets=len(names), seconds=round(sweep_s, 1), ms_median=round(statistics.median(times), 1),
        ms_p90=round(sorted(times)[int(len(times) * 0.9)], 1), ms_max=round(max(times), 1),
        statuses=dict(statuses), sessions=dict(sessions), problems=problems[:40], problem_count=len(problems))
    keys = Counter()
    for res in rows.values():
        keys.update(res.keys())
    out("ticker_keys", keys=dict(keys))
    nft = Counter()
    mismatch = []
    for name, res in rows.items():
        nf = int(res.get("next_funding_time") or 0)
        nft[time.strftime("%H:%M:%S", time.gmtime(nf / 1e9))] += 1
        fr = float(res.get("funding_rate") or 0)
        inst = by_name[name]
        cap = float(inst.get("adjusted_funding_rate_cap") or 0)
        floor = float(inst.get("adjusted_funding_rate_floor") or 0)
        if cap and not (floor - 1e-12 <= fr <= cap + 1e-12):
            mismatch.append({"name": name, "funding_rate": fr, "cap": cap, "floor": floor})
    out("next_funding_time_utc", counts=dict(nft))
    out("funding_rate_outside_cap", rows=mismatch)
    by_interval = Counter()
    for name, res in rows.items():
        by_interval[str(by_name[name].get("funding_interval_hours"))] += 1
    out("interval_of_swept", counts=dict(by_interval))
    gaps = []
    for name, res in rows.items():
        m, ix = float(res["mark_price"]), float(res["index_price"])
        gaps.append((abs(m / ix - 1) * 1e6, name, res.get("status"), res.get("session")))
    gaps.sort(reverse=True)
    out("mark_index_gap_ppm_top", rows=[{"name": n, "ppm": round(p), "status": s, "session": se} for p, n, s, se in gaps[:12]])
    sample = {k: rows[k] for k in list(rows)[:1]}
    out("ticker_sample", rows=sample)
    tradfi = {n: (r.get("status"), r.get("session")) for n, r in rows.items() if r.get("session") not in (None, "", "REGULAR") or r.get("status") != "ACTIVE"}
    out("non_regular_rows", rows=tradfi)
    # one-second polls of three markets, to count how often each number changes
    thin = min(rows, key=lambda n: float(rows[n].get("buy_volume_24h_q") or 0) + float(rows[n].get("sell_volume_24h_q") or 0))
    watch = ["BTC_USDT_Perp", "ETH_USDT_Perp", thin]
    last = {n: None for n in watch}
    changes = {n: Counter() for n in watch}
    event_steps = {n: [] for n in watch}
    ages = {n: [] for n in watch}
    for _ in range(60):
        tick = time.perf_counter()
        for n in watch:
            r, data, ms, sent_ns, recv_ns = post(client, "ticker", {"instrument": n})
            res = data["result"]
            ages[n].append((recv_ns - int(res["event_time"])) / 1e6)
            if last[n] is not None:
                for f in ("mark_price", "index_price", "funding_rate", "event_time", "next_funding_time", "best_bid_price"):
                    if res.get(f) != last[n].get(f):
                        changes[n][f] += 1
                event_steps[n].append((int(res["event_time"]) - int(last[n]["event_time"])) / 1e6)
            last[n] = res
        wait = 1.0 - (time.perf_counter() - tick)
        if wait > 0:
            time.sleep(wait)
    for n in watch:
        steps = [s for s in event_steps[n] if s > 0]
        out("one_second_poll", market=n, polls=60, changes=dict(changes[n]),
            event_time_ms_mod_1000=dict(Counter(int(last[n]["event_time"]) // 1_000_000 % 1000 for _ in [0])),
            event_step_ms_median=round(statistics.median(steps), 1) if steps else None,
            age_ms_min=round(min(ages[n]), 1), age_ms_median=round(statistics.median(ages[n]), 1), age_ms_max=round(max(ages[n]), 1))


def mode_funding(client):
    perps = active_perps(client)
    by_interval = {}
    for x in perps:
        by_interval.setdefault(str(x.get("funding_interval_hours")), []).append(x["instrument"])
    picks = ["BTC_USDT_Perp", "ETH_USDT_Perp"] + [v[0] for k, v in sorted(by_interval.items()) if v[0] not in ("BTC_USDT_Perp", "ETH_USDT_Perp")]
    for name in picks:
        r, data, ms, _, _ = post(client, "funding", {"instrument": name, "limit": 12})
        rows = (data or {}).get("result") or []
        _, tdata, _, _, _ = post(client, "ticker", {"instrument": name})
        tick = tdata["result"]
        inst = next(x for x in perps if x["instrument"] == name)
        hist = [{"utc": time.strftime("%m-%d %H:%M:%S", time.gmtime(int(x["funding_time"]) / 1e9)),
                 "ms_after_second": int(x["funding_time"]) // 1_000_000 % 1000,
                 "rate": x["funding_rate"], "interval": x.get("funding_interval_hours"),
                 "avg8h": x.get("funding_rate_8_h_avg"), "mark": x.get("mark_price")} for x in rows[:6]]
        out("funding_history", market=name, status=r.status_code, ms=round(ms, 1), rows=len(rows), next=bool(data.get("next")),
            catalog_interval=inst.get("funding_interval_hours"), cap=inst.get("adjusted_funding_rate_cap"),
            ticker_rate=tick.get("funding_rate"), ticker_8h_curr=tick.get("funding_rate_8h_curr"),
            ticker_8h_avg=tick.get("funding_rate_8h_avg"),
            ticker_next_utc=time.strftime("%m-%d %H:%M:%S", time.gmtime(int(tick["next_funding_time"]) / 1e9)),
            history=hist)
        time.sleep(0.5)
    r, data, ms, _, _ = post(client, "funding", {"instrument": "BTC_USDT_Perp", "limit": 3, "agg_type": "ONE_HOURLY"})
    out("funding_one_hourly", status=r.status_code, rows=[{"utc": time.strftime("%m-%d %H:%M", time.gmtime(int(x["funding_time"]) / 1e9)), "rate": x["funding_rate"], "interval": x.get("funding_interval_hours")} for x in (data or {}).get("result", [])])


def mode_book(client):
    for depth in (10, 50, 100, 500, 20):
        r, data, ms, sent_ns, recv_ns = post(client, "book", {"instrument": "BTC_USDT_Perp", "depth": depth})
        res = (data or {}).get("result") or {}
        bids, asks = res.get("bids") or [], res.get("asks") or []
        bp = [float(x["price"]) for x in bids]
        ap = [float(x["price"]) for x in asks]
        out("rest_book", depth=depth, status=r.status_code, ms=round(ms, 1), bytes=len(r.content), bids=len(bids), asks=len(asks),
            bids_descending=bp == sorted(bp, reverse=True), asks_ascending=ap == sorted(ap),
            top=[bids[:1], asks[:1]], age_ms=round((recv_ns - int(res["event_time"])) / 1e6, 1) if res.get("event_time") else None,
            event_ms_mod_1000=int(res["event_time"]) // 1_000_000 % 1000 if res.get("event_time") else None,
            num_orders_type=type(bids[0]["num_orders"]).__name__ if bids else None, error=None if res else data)
        time.sleep(0.5)
    # two books a few hundred ms apart, to see whether REST replies come from a cache
    stamps = []
    for _ in range(6):
        r, data, ms, _, _ = post(client, "book", {"instrument": "BTC_USDT_Perp", "depth": 10})
        stamps.append(int(data["result"]["event_time"]))
        time.sleep(0.25)
    out("rest_book_event_steps_ms", steps=[round((b - a) / 1e6, 1) for a, b in zip(stamps, stamps[1:])])


def mode_errors(client):
    cases = [
        ("ticker unknown instrument", "post", "full/v1/ticker", {"instrument": "NOPE_USDT_Perp"}),
        ("ticker lowercase instrument", "post", "full/v1/ticker", {"instrument": "btc_usdt_perp"}),
        ("ticker delisted instrument", "post", "full/v1/ticker", {"instrument": "TON_USDT_Perp"}),
        ("book delisted instrument", "post", "full/v1/book", {"instrument": "TON_USDT_Perp", "depth": 10}),
        ("book unknown instrument", "post", "full/v1/book", {"instrument": "NOPE_USDT_Perp", "depth": 10}),
        ("ticker empty body", "post", "full/v1/ticker", {}),
        ("ticker GET", "get", "full/v1/ticker", None),
        ("ticker malformed json", "raw", "full/v1/ticker", b"{not json"),
        ("lite ticker", "post", "lite/v1/ticker", {"i": "BTC_USDT_Perp"}),
        ("unknown path", "post", "full/v1/nothing_here", {}),
    ]
    for label, how, path, body in cases:
        url = f"{BASE}/{path}"
        if how == "post":
            r = client.post(url, json=body)
        elif how == "get":
            r = client.get(url)
        else:
            r = client.post(url, content=body, headers={"content-type": "application/json"})
        text = r.text[:300]
        out("error_case", case=label, status=r.status_code, body=text, retry_after=r.headers.get("retry-after"))
        time.sleep(0.3)


def mode_binance(client):
    # GRVT's caps and intervals against Binance's fundingInfo, where Binance gives the cap as a fraction
    perps = active_perps(client)
    info = httpx.get("https://fapi.binance.com/fapi/v1/fundingInfo", timeout=15)
    if info.status_code == 200:
        bmap = {x["symbol"]: x for x in info.json()}
        same_cap, other_cap, same_interval, other_interval, sample = 0, [], 0, [], []
        for x in perps:
            name = {"KBONK": "1000BONK", "KPEPE": "1000PEPE", "KSHIB": "1000SHIB"}.get(x["base"], x["base"])
            b = bmap.get(f"{name}USDT")
            if not b:
                continue
            g_cap = float(x["adjusted_funding_rate_cap"])
            b_cap_pct = float(b["adjustedFundingRateCap"]) * 100
            if abs(g_cap - b_cap_pct) < 1e-9:
                same_cap += 1
            else:
                other_cap.append((x["base"], g_cap, b_cap_pct))
            if int(x["funding_interval_hours"]) == int(b["fundingIntervalHours"]):
                same_interval += 1
            else:
                other_interval.append((x["base"], x["funding_interval_hours"], b["fundingIntervalHours"]))
            if x["base"] in ("BTC", "SOL", "KAIA", "ASTER"):
                sample.append((x["base"], x["adjusted_funding_rate_cap"], b["adjustedFundingRateCap"], x["funding_interval_hours"], b["fundingIntervalHours"]))
        out("caps_vs_binance_fundinginfo", compared=same_cap + len(other_cap), cap_equal_to_binance_times_100=same_cap,
            cap_other=other_cap[:10], interval_equal=same_interval, interval_other=other_interval[:10], sample=sample)
    else:
        out("binance_fundinginfo_refused", status=info.status_code, body=info.text[:300])
    # the K names against Binance's 1000-coin contracts, read one after the other
    for k, thousand in (("KBONK", "1000BONK"), ("KPEPE", "1000PEPE"), ("KSHIB", "1000SHIB")):
        _, data, _, _, _ = post(client, "ticker", {"instrument": f"{k}_USDT_Perp"})
        g = data["result"]
        b = httpx.get("https://fapi.binance.com/fapi/v1/premiumIndex", params={"symbol": f"{thousand}USDT"}, timeout=10).json()
        out("thousand_coin_name", grvt=k, grvt_mark=g["mark_price"], grvt_index=g["index_price"], binance=f"{thousand}USDT",
            binance_mark=b["markPrice"], binance_index=b["indexPrice"],
            mark_gap_ppm=round((float(g["mark_price"]) / float(b["markPrice"]) - 1) * 1e6, 1))
        time.sleep(0.2)
    coins = ["BTC", "ETH", "SOL", "DOGE", "XRP", "LINK"]
    for sample in range(10):
        tick = time.perf_counter()
        b = httpx.get("https://fapi.binance.com/fapi/v1/premiumIndex", timeout=10)
        if b.status_code != 200:
            out("binance_refused", status=b.status_code, body=b.text[:300])
            return
        bmap = {x["symbol"]: x for x in b.json()}
        rows = []
        for c in coins:
            _, data, _, _, recv_ns = post(client, "ticker", {"instrument": f"{c}_USDT_Perp"})
            g = data["result"]
            bx = bmap.get(f"{c}USDT")
            gi, gm = float(g["index_price"]), float(g["mark_price"])
            bi, bm = float(bx["indexPrice"]), float(bx["markPrice"])
            rows.append({"coin": c, "grvt_index": g["index_price"], "binance_index": bx["indexPrice"],
                         "index_gap_ppm": round((gi / bi - 1) * 1e6, 1), "grvt_mark": g["mark_price"],
                         "binance_mark": bx["markPrice"], "mark_gap_ppm": round((gm / bm - 1) * 1e6, 1),
                         "grvt_event_ms": int(g["event_time"]) // 1_000_000, "binance_time": bx["time"]})
        out("index_vs_binance", sample=sample, rows=rows)
        wait = 1.0 - (time.perf_counter() - tick)
        if wait > 0:
            time.sleep(wait)


def mode_collisions(client):
    """GRVT bases that Binance USD-M or Bybit linear also list, with each venue's mark, flagged past 2 percent."""
    perps = active_perps(client)
    by_base = {x["base"]: x for x in perps}
    binfo = httpx.get("https://fapi.binance.com/fapi/v1/exchangeInfo", timeout=15)
    bprem = httpx.get("https://fapi.binance.com/fapi/v1/premiumIndex", timeout=15)
    by = httpx.get("https://api.bybit.com/v5/market/tickers", params={"category": "linear"}, timeout=15)
    out("reference_status", binance_info=binfo.status_code, binance_premium=bprem.status_code, bybit=by.status_code)
    bsym = {}
    if binfo.status_code == 200:
        for s in binfo.json()["symbols"]:
            if "PERPETUAL" in (s.get("contractType") or "") and s.get("quoteAsset") == "USDT" and s.get("status") == "TRADING":
                bsym[s["baseAsset"]] = s
        out("binance_contract_types", counts=dict(Counter(s.get("contractType") for s in bsym.values())))
    bmark = {x["symbol"]: float(x["markPrice"]) for x in bprem.json()} if bprem.status_code == 200 else {}
    ymark = {}
    if by.status_code == 200:
        for t in by.json()["result"]["list"]:
            if t["symbol"].endswith("USDT"):
                ymark[t["symbol"][:-4]] = float(t["markPrice"] or 0)
    rows = []
    for base, inst in sorted(by_base.items()):
        on_b, on_y = base in bsym, base in ymark
        if not (on_b or on_y):
            continue
        _, data, _, _, _ = post(client, "ticker", {"instrument": inst["instrument"]})
        gm = float(data["result"]["mark_price"])
        bm = bmark.get(f"{base}USDT") if on_b else None
        ym = ymark.get(base) if on_y else None
        refs = [m for m in (bm, ym) if m]
        worst = max((abs(gm / m - 1) for m in refs), default=0)
        rows.append({"base": base, "asset_class": inst.get("asset_class"), "binance": on_b,
                     "binance_underlying": bsym[base].get("underlyingType") if on_b else None,
                     "binance_contract_type": bsym[base].get("contractType") if on_b else None,
                     "binance_subtype": bsym[base].get("underlyingSubType") if on_b else None, "bybit": on_y,
                     "grvt_mark": gm, "binance_mark": bm, "bybit_mark": ym, "worst_gap_pct": round(worst * 100, 3)})
        time.sleep(0.12)
    out("shared_bases", count=len(rows), by_class=dict(Counter(r["asset_class"] for r in rows)),
        on_binance=sum(r["binance"] for r in rows), on_bybit=sum(r["bybit"] for r in rows))
    out("shared_non_crypto", rows=[r for r in rows if r["asset_class"] != "CRYPTO"])
    out("over_2_pct", rows=[r for r in rows if r["worst_gap_pct"] > 2])
    out("grvt_only_bases", count=len(by_base) - len(rows),
        bases=sorted(b for b in by_base if b not in bsym and b not in ymark))


MODES = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "funding": mode_funding,
         "book": mode_book, "errors": mode_errors, "binance": mode_binance, "collisions": mode_collisions}


def main():
    chosen = sys.argv[1:] or list(MODES)
    with httpx.Client(timeout=10) as client:
        for m in chosen:
            out("mode", name=m, utc=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
            MODES[m](client)


if __name__ == "__main__":
    main()
