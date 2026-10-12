# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for AEGET, whose web app serves XT.com's futures layout under /futures/fapi.

Modes, each runnable alone: host, catalog, anchor, book, errors, all (the default).
Run from the repository root: uv run scripts/probes/venues/aeget/rest-probe.py [mode]
Captures go to .claude/survey-work/aeget/.
"""

import collections
import json
import socket
import ssl
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/aeget")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
SITE = "https://aeget.io"
FAPI = f"{SITE}/futures/fapi/market/v1/public"
DAPI = f"{SITE}/futures/dapi/market/v1/public"
SPOT = f"{SITE}/pro/p/symbol/list"
XT_DEPTH = "https://fapi.xt.com/future/market/v1/public/q/depth?symbol=btc_usdt&level=5"
CMC = "https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=aeget&category={cat}&start={start}&limit=100"
WATCH = ["btc_usdt", "eth_usdt", "sol_usdt", "xrp_usdt", "doge_usdt"]


def request(url: str, timeout: float = 30) -> tuple[int, dict, bytes, float]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as reply:
            return reply.status, dict(reply.headers), reply.read(), (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), (time.perf_counter() - start) * 1000


def get_json(url: str):
    status, headers, raw, ms = request(url)
    ctype = headers.get("Content-Type", "")
    if "json" not in ctype:
        return status, None, ms, len(raw), ctype
    return status, json.loads(raw), ms, len(raw), ctype


def save(name: str, payload) -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    (WORK / name).write_text(json.dumps(payload, indent=1)[:2_000_000])


def tls_attempt(host: str) -> str:
    context = ssl.create_default_context()
    try:
        with socket.create_connection((host, 443), timeout=15) as raw:
            with context.wrap_socket(raw, server_hostname=host) as tls:
                return f"handshake ok, {tls.version()}"
    except Exception as error:  # the refusal itself is the finding
        return f"{type(error).__name__}: {error}"


def host() -> None:
    print("## host")
    for name in ["www.aeget.com", "aeget.com", "aeget.io", "cdn.aeget.com", "api.aeget.com", "openapi.aeget.com", "futuresopenapi.aeget.com"]:
        try:
            addresses = sorted({info[4][0] for info in socket.getaddrinfo(name, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as error:
            print(f"dns {name}: {error}")
            continue
        print(f"dns {name}: {len(addresses)} addresses, {addresses[:4]}")
    for name in ["www.aeget.com", "aeget.com", "cdn.aeget.com", "aeget.io"]:
        print(f"tls {name}: {tls_attempt(name)}")
    try:
        status, _, raw, ms = request("http://www.aeget.com/", timeout=15)
        print(f"http www.aeget.com: {status} {len(raw)} bytes {ms:.0f} ms")
    except Exception as error:
        print(f"http www.aeget.com: {type(error).__name__}: {error}")
    times = []
    for _ in range(4):
        status, body, ms, size, _ = get_json(f"{FAPI}/time")
        times.append(ms)
    print(f"time call: cold {times[0]:.0f} ms, warm {', '.join(f'{t:.0f}' for t in times[1:])} ms")
    sent = time.time() * 1000
    status, body, ms, size, _ = get_json(f"{FAPI}/time")
    local_mid = sent + ms / 2
    print(f"server time {body['data']}, local midpoint {local_mid:.0f}, offset {body['data'] - local_mid:.0f} ms")


def catalog() -> list[dict]:
    print("## catalog")
    status, body, ms, size, _ = get_json(f"{FAPI}/symbol/list")
    rows = body["data"]
    save("symbol-list.json", body)
    print(f"symbol/list: {status}, {len(rows)} rows, {size} bytes, {ms:.0f} ms")
    kinds = collections.Counter((r["contractType"], r["underlyingType"], r["quoteCoin"], r["state"], r["tradeSwitch"]) for r in rows)
    for key, count in kinds.most_common():
        print(f"  {key}: {count}")
    perps = [r for r in rows if r["contractType"] == "PERPETUAL"]
    sizes = collections.Counter(r["contractSize"] for r in perps)
    print(f"  perpetual contractSize spread: {sizes.most_common(12)}")
    fees = collections.Counter((r.get("makerFee"), r.get("takerFee")) for r in perps)
    print(f"  perpetual makerFee, takerFee: {fees.most_common()}")
    print(f"  liquidationFee over all rows: {collections.Counter(r.get('liquidationFee') for r in rows).most_common()}")
    btc = next(r for r in rows if r["symbol"] == "btc_usdt")
    print("  btc_usdt:", {k: btc.get(k) for k in ["symbol", "contractSize", "pricePrecision", "quantityPrecision", "makerFee", "takerFee", "liquidationFee", "multiplierUp", "multiplierDown", "onboardDate", "state", "tradeSwitch"]})
    bases = collections.Counter(r["baseCoin"] for r in rows)
    print(f"  bases listed twice: {[b for b, c in bases.items() if c > 1]}")
    print(f"  event contracts: {[r['symbol'] for r in rows if r['contractType'] != 'PERPETUAL']}")
    status, dbody, ms, size, _ = get_json(f"{DAPI}/symbol/list")
    print(f"dapi symbol/list: {status}, {len(dbody['data'])} rows")
    status, sbody, ms, size, _ = get_json(SPOT)
    print(f"spot /pro/p/symbol/list: {status}, {len(sbody['data'])} rows")
    status, bare, ms, size, ctype = get_json(f"{SITE}/fapi/market/v1/public/symbol/list")
    print(f"bare /fapi path without /futures: {status}, {size} bytes, content-type {ctype}")
    cmc = []
    for start in (1, 101, 201, 301):
        status, page, ms, size, _ = get_json(CMC.format(cat="perpetual", start=start))
        batch = page["data"]["marketPairs"]
        cmc += batch
        if len(batch) < 100:
            break
    print(f"CoinMarketCap perpetual pairs: {len(cmc)}, quotes {collections.Counter(p['quoteSymbol'] for p in cmc)}")
    return perps


def anchor(perps: list[dict]) -> None:
    print("## anchor")
    status, body, ms, size, _ = get_json(f"{FAPI}/q/agg-tickers")
    rows = body["data"]
    save("agg-tickers.json", body)
    perp_names = {r["symbol"] for r in perps}
    print(f"q/agg-tickers: {status}, {len(rows)} rows, {size} bytes, {ms:.0f} ms, perpetuals covered {len(perp_names & {r['s'] for r in rows})} of {len(perp_names)}")
    same_im = sum(1 for r in rows if r.get("i") == r.get("m"))
    same_mc = sum(1 for r in rows if r.get("m") == r.get("c"))
    print(f"  i equals m on {same_im} of {len(rows)}, m equals c on {same_mc} of {len(rows)}")
    for path in ["q/mark-price", "q/index-price"]:
        status, b, ms, size, _ = get_json(f"{FAPI}/{path}")
        print(f"{path}: {status}, {len(b['data'])} rows, {size} bytes, {ms:.0f} ms")
    status, marks, *_ = get_json(f"{FAPI}/q/mark-price")
    status, indexes, *_ = get_json(f"{FAPI}/q/index-price")
    mark_by = {r["s"]: r for r in marks["data"]}
    index_by = {r["s"]: r for r in indexes["data"]}
    both = set(mark_by) & set(index_by)
    print(f"  bulk mark p equals bulk index p on {sum(1 for s in both if mark_by[s]['p'] == index_by[s]['p'])} of {len(both)}")
    funding = {}
    for symbol in WATCH:
        status, b, ms, size, _ = get_json(f"{FAPI}/q/funding-rate?symbol={symbol}")
        funding[symbol] = b["data"]
        status, rec, *_ = get_json(f"{FAPI}/q/funding-rate-record?symbol={symbol}")
        print(f"  funding-rate {symbol}: {json.dumps(b['data'])}, record items {len(rec['data']['items'])}")
        time.sleep(0.3)
    nulls = sum(1 for v in funding.values() if v.get("fundingRate") is None)
    print(f"  fundingRate null on {nulls} of {len(funding)}")
    print("  30 one second polls of q/agg-tickers for btc_usdt and eth_usdt:")
    changes = collections.Counter()
    last = {}
    latencies = []
    for _ in range(30):
        status, b, ms, *_ = get_json(f"{FAPI}/q/agg-tickers")
        latencies.append(ms)
        for r in b["data"]:
            if r["s"] in ("btc_usdt", "eth_usdt"):
                for field in ("i", "m", "c"):
                    key = (r["s"], field)
                    if key in last and last[key] != r[field]:
                        changes[key] += 1
                    last[key] = r[field]
                if r["i"] != r["c"]:
                    changes[(r["s"], "i differs from c")] += 1
        time.sleep(max(0, 1 - ms / 1000))
    print(f"  latency min {min(latencies):.0f}, median {statistics.median(latencies):.0f}, max {max(latencies):.0f} ms")
    for key, count in sorted(changes.items()):
        print(f"  {key}: {count} of 29")


def book() -> None:
    print("## book")
    for level in (5, 50, 500, 1000):
        status, b, ms, size, _ = get_json(f"{FAPI}/q/depth?symbol=btc_usdt&level={level}")
        if b is None or b.get("data") is None:
            print(f"depth level {level}: {status} {json.dumps(b)[:200]}")
            continue
        d = b["data"]
        bids, asks = d["b"], d["a"]
        bids_desc = all(float(bids[i][0]) > float(bids[i + 1][0]) for i in range(len(bids) - 1))
        asks_asc = all(float(asks[i][0]) < float(asks[i + 1][0]) for i in range(len(asks) - 1))
        print(f"depth level {level}: {status}, {len(bids)} bids, {len(asks)} asks, {size} bytes, {ms:.0f} ms, bids descending {bids_desc}, asks ascending {asks_asc}, u {d['u']}")
        if level == 5:
            save("depth-btc.json", b)
            print(f"  top: bid {bids[0]}, ask {asks[0]}")
    for attempt in range(2):
        status, ours, ms, *_ = get_json(f"{FAPI}/q/depth?symbol=btc_usdt&level=5")
        try:
            xs, xt, xms, *_ = get_json(XT_DEPTH)
            xd = xt["result"]  # XT wraps its reply as returnCode, msgInfo, result
            od = ours["data"]
            print(f"xt compare {attempt}: aeget u {od['u']} top {od['b'][0]} {od['a'][0]}, xt u {xd['u']} top {xd['b'][0]} {xd['a'][0]}, same u {od['u'] == xd['u']}, same top {od['b'][:2] == xd['b'][:2] and od['a'][:2] == xd['a'][:2]}")
        except Exception as error:
            print(f"xt compare {attempt}: XT call failed, {type(error).__name__}: {error}")
        time.sleep(1)
    print("index against the book mid and the XT index, per symbol:")
    for symbol in WATCH:
        status, d, *_ = get_json(f"{FAPI}/q/depth?symbol={symbol}&level=5")
        status, idx, *_ = get_json(f"{FAPI}/q/index-price?symbol={symbol}")
        status, mark, *_ = get_json(f"{FAPI}/q/mark-price?symbol={symbol}")
        try:
            xs, xidx, *_ = get_json(f"https://fapi.xt.com/future/market/v1/public/q/index-price?symbol={symbol}")
            xt_index = float(xidx["result"][0]["p"])
        except Exception as error:
            xt_index = float("nan")
        bid, ask = float(d["data"]["b"][0][0]), float(d["data"]["a"][0][0])
        index = float(idx["data"][0]["p"])
        print(f"  {symbol}: bid {bid}, ask {ask}, mid {(bid + ask) / 2:.8g}, index {index}, mark {mark['data'][0]['p']}, index inside the spread {bid <= index <= ask}, XT index {xt_index}, gap to XT {(index / xt_index - 1) * 1e4:.1f} bp")
        time.sleep(0.3)


def errors() -> None:
    print("## errors")
    for url in [f"{FAPI}/q/depth?symbol=nope_usdt&level=5", f"{FAPI}/q/depth", f"{FAPI}/q/nothing", f"{FAPI}/q/funding-rate?symbol=nope_usdt"]:
        status, headers, raw, ms = request(url)
        print(f"{url.removeprefix(FAPI)}: {status}, {headers.get('Content-Type')}, {raw[:200]!r}")
    status, headers, raw, ms = request(f"{FAPI}/symbol/list")
    limit_headers = {k: v for k, v in headers.items() if "limit" in k.lower() or k.lower() in ("retry-after", "server", "cf-ray")}
    print(f"headers of symbol/list: {limit_headers}")


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print(f"aeget rest probe, {datetime.now(timezone.utc).isoformat(timespec='seconds')}, mode {mode}")
    if mode in ("host", "all"):
        host()
    perps = catalog() if mode in ("catalog", "anchor", "all") else []
    if mode in ("anchor", "all"):
        anchor(perps)
    if mode in ("book", "all"):
        book()
    if mode in ("errors", "all"):
        errors()


if __name__ == "__main__":
    main()
