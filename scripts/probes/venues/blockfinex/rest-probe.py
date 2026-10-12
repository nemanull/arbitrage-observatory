# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for the Blockfinex futures open API, a ChainUp fapi/v1 deployment.

Public, unauthenticated, read-only, and at most eight requests in flight, about eight a second.
Standard library only.

Modes, each printing one JSON line per finding:
    latency   cold and warm timings of /fapi/v1/time, /index and /depth, the server clock offset.
    catalog   /fapi/v1/contracts, /v1/inner/contract_config and the website's common/public_info, cross-checked.
    anchor    one /index round over every trading USDT perpetual, then 60 one second polls of five contracts with the ticker.
    funding   for every trading USDT perpetual, /index beside the last settled rate of common/funding_rate_list.
    depth     /depth limits, level order, the time field, and the size unit of SHIB and PEPE against DOGE and TRX.
    errors    unknown contracts, missing parameters, unknown and private paths.
    outside   Blockfinex index and mark beside Binance USD-M premiumIndex for BTC, ETH, SOL and SHIB, one read each,
              then three paired reads of the BTC and ETH books beside Binance's.
    all       every mode above in turn, about two and a half minutes.

Run from the repository root:
    uv run scripts/probes/venues/blockfinex/rest-probe.py [latency|catalog|anchor|funding|depth|errors|outside|all]

Recorded in docs/profiles/blockfinex/rest.md and fees.md.
"""

import collections
import concurrent.futures
import http.client
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request

HOST = "futuresopenapi.blockfinex.com"
API = f"https://{HOST}/fapi/v1"
WEB = "https://futures.blockfinex.com/fe-co-api"
BINANCE = "https://fapi.binance.com/fapi/v1"
UA = {"User-Agent": "observatory-probe", "Content-Type": "application/json"}


def log(tag: str, **fields) -> None:
    print(json.dumps({"tag": tag, "at": round(time.time(), 3), **fields}, default=str), flush=True)


def fetch(url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, bytes, float, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})}, method="POST" if data else "GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, raw, (time.perf_counter() - t0) * 1000, dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), (time.perf_counter() - t0) * 1000, dict(e.headers)


def get(url: str):
    status, raw, ms, _ = fetch(url)
    return json.loads(raw), ms


def web(path: str, params: dict | None = None):
    # The web app posts a uaTime beside its parameters and a futures-version header, and an empty body answers 200004 parameter illegal.
    body = {**(params or {}), "uaTime": time.strftime("%Y-%m-%d %H:%M:%S")}
    status, raw, ms, _ = fetch(f"{WEB}/{path}", body, {"futures-version": "101", "exchange-client": "pc", "exchange-language": "en_US"})
    return json.loads(raw), ms, len(raw)


def socket_name(contract: str) -> str:
    kind, _, rest = contract.lower().partition("-")
    return f"{kind}_{rest.replace('-', '')}"


def trading_usdt(rows: list[dict]) -> list[dict]:
    return [r for r in rows if r["status"] == 1 and r["type"] == "E" and r["side"] == 1 and r["symbol"].endswith("-USDT")]


def ppm(a: float, b: float) -> float:
    return round((a - b) / b * 1e6, 1)


def spread(values: list[float]) -> list:
    return [round(min(values), 1), round(statistics.median(values), 1), round(max(values), 1)] if values else None


def latency() -> None:
    log("resolve", addresses=sorted({a[4][0] for a in socket.getaddrinfo(HOST, 443, proto=socket.IPPROTO_TCP)}))
    for path in ["/fapi/v1/time", "/fapi/v1/index?contractName=E-BTC-USDT", "/fapi/v1/depth?contractName=E-BTC-USDT&limit=100"]:
        cold = []
        for _ in range(3):
            conn = http.client.HTTPSConnection(HOST, timeout=15)
            t0 = time.perf_counter()
            conn.request("GET", path, headers=UA)
            conn.getresponse().read()
            cold.append((time.perf_counter() - t0) * 1000)
            conn.close()
        conn = http.client.HTTPSConnection(HOST, timeout=15)
        conn.request("GET", path, headers=UA)
        conn.getresponse().read()
        warm = []
        for _ in range(10):
            t0 = time.perf_counter()
            conn.request("GET", path, headers=UA)
            r = conn.getresponse()
            r.read()
            warm.append((time.perf_counter() - t0) * 1000)
            time.sleep(0.2)
        log("latency", path=path, cold_ms=[round(x) for x in cold], warm_ms=spread(warm), server=r.getheader("server"))
        conn.close()
    # One kept-alive connection, so each sample is one request and its answer, without a handshake inside the round trip.
    conn = http.client.HTTPSConnection(HOST, timeout=15)
    conn.request("GET", "/fapi/v1/time", headers=UA)
    conn.getresponse().read()
    offsets = []
    for _ in range(10):
        t0 = time.time() * 1000
        conn.request("GET", "/fapi/v1/time", headers=UA)
        reply = json.loads(conn.getresponse().read())
        t1 = time.time() * 1000
        offsets.append((t1 - t0, reply["serverTime"] - (t0 + t1) / 2))
        time.sleep(0.3)
    conn.close()
    offsets.sort()
    log("clock", reply=reply, offset_ms_at_shortest_rtt=[round(o, 1) for _, o in offsets[:3]], rtt_ms=[round(r) for r, _ in offsets[:3]])


def catalog() -> None:
    status, raw, ms, _ = fetch(f"{API}/contracts")
    rows = json.loads(raw)
    log(
        "contracts",
        bytes=len(raw),
        ms=round(ms),
        rows=len(rows),
        groups=collections.Counter(f"type {r['type']} side {r['side']} status {r['status']} margin {r['marginCoin']} quote {r['symbol'].split('-')[-1]}" for r in rows),
        not_trading=[r["symbol"] for r in rows if r["status"] != 1],
        fields=sorted({k for r in rows for k in r}),
        example=next(r for r in rows if r["symbol"] == "E-BTC-USDT"),
    )
    act = trading_usdt(rows)
    log(
        "usdt_perpetuals",
        count=len(act),
        sized_in_base=sum(r["multiplierCoin"] == r["symbol"].split("-")[1] for r in act),
        bases_twice=[b for b, n in collections.Counter(r["symbol"].split("-")[1] for r in act).items() if n > 1],
        multipliers=sorted({r["multiplier"] for r in act}),
        open_taker=collections.Counter(r["openTakerFee"] for r in act),
        close_taker=collections.Counter(r["closeTakerFee"] for r in act),
        open_maker=collections.Counter(r["openMakerFee"] for r in act),
        taker_of=dict(sorted((r["symbol"], r["openTakerFee"]) for r in act if r["symbol"] in ("E-BTC-USDT", "E-ETH-USDT", "E-SOL-USDT", "E-XAU-USDT", "E-TSLA-USDT"))),
    )
    inverse = [r for r in rows if r["side"] == 0]
    log("inverse_and_other", rows=[{k: r[k] for k in ("symbol", "type", "side", "status", "marginCoin", "multiplier", "multiplierCoin")} for r in rows if r["side"] == 0 or r["type"] != "E"], inverse=len(inverse))

    cfg, cms = get(f"https://{HOST}/v1/inner/contract_config")
    lst = cfg["data"]["contractList"]
    log(
        "contract_config",
        code=cfg["code"],
        ms=round(cms),
        rows=len(lst),
        groups=collections.Counter(f"type {r['contractType']} side {r['contractSide']} status {r['status']} every {r['capitalFrequency']} h" for r in lst),
        premium_bounds=collections.Counter(f"{r['capitalPremiumMin']} to {r['capitalPremiumMax']}" for r in lst),
        has_next_settlement=any("nextCapitalSettTime" in r for r in lst),
        missing_from_config=[r["symbol"] for r in act if r["symbol"] not in {c["contractName"] for c in lst}],
    )
    info, ims, size = web("common/public_info")
    data = info["data"]
    pl = data["contractList"]
    act_names = {r["symbol"] for r in act}
    log(
        "public_info",
        code=info["code"],
        ms=round(ims),
        bytes_gzip_or_plain=size,
        rows=len(pl),
        ws_url=data.get("wsUrl"),
        server_ms=data.get("currentTimeMillis"),
        sub_symbol_rule_holds=sum(r["subSymbol"] == socket_name(r["contractName"]) for r in pl),
        intervals=collections.Counter(r["capitalFrequency"] for r in pl if r["contractName"] in act_names),
        next_settlements=collections.Counter(time.strftime("%H:%M UTC", time.gmtime(r["nextCapitalSettTime"] / 1000)) for r in pl if r["contractName"] in act_names),
        interval_bounds=collections.Counter(f"{r['capitalIntervalMin']} to {r['capitalIntervalMax']}" for r in pl if r["contractName"] in act_names),
        asset_class=collections.Counter(r.get("assetClass") for r in pl if r["contractName"] in act_names),
        fee_rate_vo_equals_contracts=sum(r["feeRateVo"]["openTakerFeeRate"] == next(a["openTakerFee"] for a in act if a["symbol"] == r["contractName"]) for r in pl if r["contractName"] in act_names),
        liquidation_rate=collections.Counter(r.get("liquidationRate") for r in pl if r["contractName"] in act_names),
        multiplier_equal=sum(r["multiplier"] == next(a["multiplier"] for a in act if a["symbol"] == r["contractName"]) for r in pl if r["contractName"] in act_names),
    )
    asset = {r["contractName"]: r.get("assetClass") for r in pl}
    log("asset_class_members", classes={str(k): sorted(n for n, c in asset.items() if c == k and n in act_names) for k in set(asset.values())})


def index_round(names: list[str], workers: int = 8) -> tuple[dict, list[float], float]:
    t0 = time.perf_counter()
    out, times = {}, []

    def one(name):
        status, raw, ms, _ = fetch(f"{API}/index?contractName={name}")
        return name, json.loads(raw), ms

    with concurrent.futures.ThreadPoolExecutor(workers) as pool:
        for name, reply, ms in pool.map(one, names):
            out[name] = reply
            times.append(ms)
    return out, times, (time.perf_counter() - t0) * 1000


def anchor() -> None:
    rows, _ = get(f"{API}/contracts")
    names = [r["symbol"] for r in trading_usdt(rows)]
    replies, times, total = index_round(names)
    errors = {n: r for n, r in replies.items() if "code" in r}
    good = {n: r for n, r in replies.items() if "code" not in r}
    gaps = sorted((ppm(r["tagPrice"], r["indexPrice"]), n) for n, r in good.items() if r["indexPrice"])
    log(
        "index_round",
        contracts=len(names),
        wall_ms=round(total),
        per_call_ms=spread(times),
        errors=errors,
        keys=collections.Counter(",".join(sorted(r)) for r in good.values()),
        current_equals_next=sum(r["currentFundRate"] == r["nextFundRate"] for r in good.values()),
        zero_index=[n for n, r in good.items() if not r["indexPrice"]],
        mark_minus_index_ppm_extremes=gaps[:3] + gaps[-3:],
        mark_minus_index_ppm_median=statistics.median(g for g, _ in gaps) if gaps else None,
        example=good.get("E-BTC-USDT"),
    )
    watch = ["E-BTC-USDT", "E-ETH-USDT", "E-ENJ-USDT", "E-XAU-USDT", "E-SHIB-USDT"]
    hist = {n: [] for n in watch}
    tick = []
    for _ in range(60):
        t0 = time.perf_counter()
        polled, _, _ = index_round(watch, workers=5)
        for n in watch:
            hist[n].append(polled[n])
        t, _ = get(f"{API}/ticker?contractName=E-BTC-USDT")
        tick.append((polled["E-BTC-USDT"]["tagPrice"], t))
        time.sleep(max(0.0, 1.0 - (time.perf_counter() - t0)))
    for n, seq in hist.items():
        def changes(key):
            return sum(a[key] != b[key] for a, b in zip(seq, seq[1:]))

        def step(key):
            return max((abs(ppm(b[key], a[key])) for a, b in zip(seq, seq[1:]) if a[key]), default=0)

        log(
            "polls",
            contract=n,
            polls=len(seq),
            index_changes=changes("indexPrice"),
            mark_changes=changes("tagPrice"),
            current_rate_changes=changes("currentFundRate"),
            next_rate_changes=changes("nextFundRate"),
            largest_index_step_ppm=step("indexPrice"),
            largest_mark_step_ppm=step("tagPrice"),
            current_rate_first_last=[seq[0]["currentFundRate"], seq[-1]["currentFundRate"]],
            next_rate_first_last=[seq[0]["nextFundRate"], seq[-1]["nextFundRate"]],
            mark_minus_index_ppm=spread([ppm(r["tagPrice"], r["indexPrice"]) for r in seq]),
        )
    log(
        "mark_against_btc_ticker",
        polls=len(tick),
        mark_equals_last=sum(m == float(t["last"]) for m, t in tick),
        mark_inside_touch=sum(t["buy"] <= m <= t["sell"] for m, t in tick),
        mark_equals_bid=sum(m == t["buy"] for m, t in tick),
        mark_equals_ask=sum(m == t["sell"] for m, t in tick),
    )


def funding() -> None:
    rows, _ = get(f"{API}/contracts")
    act = trading_usdt(rows)
    replies, _, _ = index_round([r["symbol"] for r in act])
    matches = collections.Counter()
    examples = []
    settled_at = collections.Counter()

    def last_settled(r):
        hist, _, _ = web("common/funding_rate_list", {"contractId": r["contractId"], "page": 1, "limit": 3})
        return r["symbol"], hist

    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        lists = list(pool.map(last_settled, act))
    for name, hist in lists:
        items = (hist.get("data") or {}).get("historyList") or []
        rep = replies[name]
        if not items or "code" in rep:
            matches["no history or no index"] += 1
            continue
        last = float(items[0]["amount"])
        settled_at[time.strftime("%H:%M UTC", time.gmtime(items[0]["ctime"] / 1000))] += 1
        cur, nxt = float(rep["currentFundRate"]), float(rep["nextFundRate"])
        matches["current equals last settled"] += abs(cur - last) < 1e-12
        matches["next equals last settled"] += abs(nxt - last) < 1e-12
        matches["current equals next"] += abs(cur - nxt) < 1e-12
        matches["compared"] += 1
        if name in ("E-BTC-USDT", "E-ETH-USDT", "E-BZ-USDT", "E-LAB-USDT", "E-ENJ-USDT"):
            examples.append({"contract": name, "current": cur, "next": nxt, "settled": [(i["amount"], time.strftime("%m-%d %H:%M", time.gmtime(i["ctime"] / 1000))) for i in items]})
    log("funding_compare", counts=matches, last_settled_at=settled_at, examples=examples)
    hist, ms, size = web("common/funding_rate_list", {"contractId": 1, "page": 1, "limit": 10})
    d = hist["data"]
    log("funding_history_btc", ms=round(ms), count=d.get("count"), keys=sorted(d), rows=[(i["amount"], time.strftime("%m-%d %H:%M", time.gmtime(i["ctime"] / 1000))) for i in d["historyList"]], broken_line_points=len(d.get("brokenLineList") or []))


def depth() -> None:
    for limit in (5, 30, 100, 200, None):
        q = f"&limit={limit}" if limit else ""
        reply, ms = get(f"{API}/depth?contractName=E-BTC-USDT{q}")
        bids = [l[0] for l in reply["bids"]]
        asks = [l[0] for l in reply["asks"]]
        log("depth", limit=limit, ms=round(ms), bids=len(bids), asks=len(asks), bids_descending=all(b < a for a, b in zip(bids, bids[1:])), asks_ascending=all(b > a for a, b in zip(asks, asks[1:])), time=reply.get("time"), first_level=[reply["bids"][0], reply["asks"][0]], number_type=type(reply["bids"][0][0]).__name__)
    seen = []
    for _ in range(10):
        a, _ = get(f"{API}/depth?contractName=E-ENJ-USDT&limit=30")
        seen.append(json.dumps(a, sort_keys=True))
        time.sleep(0.5)
    log("depth_repeat", contract="E-ENJ-USDT", reads=10, distinct=len(set(seen)))
    rows, _ = get(f"{API}/contracts")
    mult = {r["symbol"]: r["multiplier"] for r in rows}
    for name in ("E-SHIB-USDT", "E-PEPE-USDT", "E-DOGE-USDT", "E-TRX-USDT", "E-BTC-USDT"):
        book, _ = get(f"{API}/depth?contractName={name}&limit=30")
        notional = [l[0] * l[1] * mult[name] for l in book["bids"][:10]]
        log("size_unit", contract=name, multiplier=mult[name], best_bid=book["bids"][0][0], level_notional_usdt_if_price_times_size_times_multiplier=spread(notional))


def errors() -> None:
    cases = [
        f"{API}/index?contractName=E-NOPE-USDT",
        f"{API}/index",
        f"{API}/index?contractName=e_btcusdt",
        f"{API}/depth?contractName=E-NOPE-USDT",
        f"{API}/ticker?contractName=E-NOPE-USDT",
        f"{API}/fundingRate?contractName=E-BTC-USDT",
        f"{API}/premiumIndex",
        f"{API}/nope",
        f"https://{HOST}/nope",
        f"{WEB}/common/nope",
    ]
    for url in cases:
        status, raw, ms, headers = fetch(url)
        log("error_case", url=url, status=status, body=raw[:200].decode(errors="replace"), retry_after=headers.get("Retry-After"), rate_headers={k: v for k, v in headers.items() if "limit" in k.lower()})
    status, raw, ms, _ = fetch(f"{WEB}/common/public_info", {})
    log("error_case", url=f"{WEB}/common/public_info with an empty body", status=status, body=raw[:200].decode(errors="replace"))


def outside() -> None:
    for ours, theirs in (("E-BTC-USDT", "BTCUSDT"), ("E-ETH-USDT", "ETHUSDT"), ("E-SOL-USDT", "SOLUSDT"), ("E-SHIB-USDT", "1000SHIBUSDT")):
        b, _ = get(f"{API}/index?contractName={ours}")
        p, _ = get(f"{BINANCE}/premiumIndex?symbol={theirs}")
        log(
            "outside",
            contract=ours,
            blockfinex={"index": b["indexPrice"], "mark": b["tagPrice"], "current": b["currentFundRate"], "next": b["nextFundRate"]},
            binance={"index": p["indexPrice"], "mark": p["markPrice"], "rate": p["lastFundingRate"]},
            index_gap_ppm=ppm(float(b["indexPrice"]), float(p["indexPrice"])),
            mark_gap_ppm=ppm(float(b["tagPrice"]), float(p["markPrice"])),
        )
    books_beside_binance()


def books_beside_binance() -> None:
    rows, _ = get(f"{API}/contracts")
    mult = {r["symbol"]: r["multiplier"] for r in rows}
    for _ in range(3):
        for ours, theirs in (("E-BTC-USDT", "BTCUSDT"), ("E-ETH-USDT", "ETHUSDT")):
            with concurrent.futures.ThreadPoolExecutor(2) as pool:
                a = pool.submit(get, f"{API}/depth?contractName={ours}&limit=20")
                b = pool.submit(get, f"{BINANCE}/depth?symbol={theirs}&limit=20")
                (bf, _), (bn, _) = a.result(), b.result()
            bn_bids = {float(p): float(q) for p, q in bn["bids"]}
            bf_bids = {l[0]: l[1] * mult[ours] for l in bf["bids"]}
            shared = set(bn_bids) & set(bf_bids)
            log(
                "book_beside_binance",
                contract=ours,
                blockfinex_touch=[bf["bids"][0][0], bf["asks"][0][0]],
                binance_touch=[float(bn["bids"][0][0]), float(bn["asks"][0][0])],
                shared_bid_prices_of_20=len(shared),
                equal_sizes_in_coin=sum(abs(bn_bids[p] - bf_bids[p]) < 1e-9 for p in shared),
                size_ratio_median=round(statistics.median(bf_bids[p] / bn_bids[p] for p in shared), 4) if shared else None,
            )
        time.sleep(2)


MODES = {"latency": latency, "catalog": catalog, "anchor": anchor, "funding": funding, "depth": depth, "errors": errors, "outside": outside}

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "catalog"
    for name, fn in MODES.items():
        if mode in ("all", name):
            fn()
