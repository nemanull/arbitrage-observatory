# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for the CZR Exchange futures open API, a ChainUp white label.

CZR's open API names its contracts with a tenant prefix, USDT1858-BTC-USDT, where other ChainUp venues write E-BTC-USDT.
Modes, each runnable alone: host, catalog, anchor, book, errors, all (the default).
Run from the repository root: uv run scripts/probes/venues/czr/rest-probe.py [mode]
Captures go to .claude/survey-work/czr/.
"""

import collections
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/czr")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
FAPI = "https://futuresopenapi.czrex.com/fapi/v1"
SAPI = "https://openapi.czrex.com/sapi/v1"
CONTRACT_CONFIG = "https://futuresopenapi.czrex.com/v1/inner/contract_config"
WEB_INFO = "https://futures.czrex.com/fe-co-api/common/public_info"
GATE = "https://api.gateio.ws/api/v4/futures/usdt/tickers"
TENANT = "USDT1858"  # the open API's `type` and `marginCoin` on every live contract
BTC = f"{TENANT}-BTC-USDT"
WATCH = [f"{TENANT}-{base}-USDT" for base in ("BTC", "ETH", "SOL", "PAXG", "CL")]
HOSTS = ["futuresopenapi.czrex.com", "futuresws.czrex.com", "futures.czrex.com", "openapi.czrex.com", "ws.czrex.com",
         "www.czrex.com", "api.czrex.com", "futuresws.czr.global", "ws.czr.global", "www.czr.global", "www.czrex.us"]


def request(url: str, body: dict | None = None, headers: dict | None = None, ua: bool = True) -> tuple[int, dict, bytes, float]:
    data = None if body is None else json.dumps(body).encode()
    all_headers = {"User-Agent": UA} if ua else {}
    if body is not None:
        all_headers["Content-Type"] = "application/json"
    all_headers.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=all_headers, method="POST" if body is not None else "GET")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            raw = reply.read()
            return reply.status, dict(reply.headers), raw, (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), (time.perf_counter() - start) * 1000
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        return 0, {}, str(error).encode(), (time.perf_counter() - start) * 1000


ODD_REPLIES: list[str] = []  # replies that were not JSON, kept so a run reports them instead of stopping


def get_json(url: str):
    status, headers, raw, ms = request(url)
    try:
        return status, json.loads(raw), ms, len(raw)
    except ValueError:
        ODD_REPLIES.append(f"{url} {status} {len(raw)} bytes, content-type {headers.get('Content-Type')}, {raw[:200]!r}")
        return status, None, ms, len(raw)


def web_info(body: dict, headers: dict | None = None):
    status, _, raw, ms = request(WEB_INFO, body, headers)
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    return status, parsed, ms, len(raw), raw


def is_live(row: dict) -> bool:
    return row.get("type") == TENANT and row.get("status") == 1 and row.get("side") == 1


def live_contracts() -> list[dict]:
    _, rows, _, _ = get_json(f"{FAPI}/contracts")
    return [row for row in rows if is_live(row)]


# The engine's ChainUp rule: lower case, the first hyphen an underscore and the others gone.
def socket_name(symbol: str) -> str:
    kind, _, rest = symbol.lower().partition("-")
    return f"{kind}_{rest.replace('-', '')}"


def gate_name(symbol: str) -> str:
    return symbol.split("-", 1)[1].replace("-", "_")


def mode_host() -> None:
    print("\n# host")
    for host in HOSTS:
        try:
            addrs = sorted({info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as error:
            addrs = [f"no address: {error}"]
        print(f"{host}: {addrs}")
    for url in ["https://www.czrex.com/", "https://www.czrex.com/cdn-cgi/trace", f"{SAPI}/ping", f"{FAPI}/ping", "https://openapi.czrex.com/",
                "https://www.czrex.us/", "https://futures.czrex.com/"]:
        status, headers, raw, ms = request(url)
        cf = headers.get("CF-RAY") or headers.get("cf-ray")
        body = raw[:400] if "trace" in url else raw[:100]
        print(f"GET {url}: {status}, {len(raw)} bytes, {ms:.0f} ms, server {headers.get('Server')}, location {headers.get('Location')}, cf-ray {cf}, body {body!r}")
    times = []
    for i in range(6):
        sent = time.time() * 1000
        status, body, ms, _ = get_json(f"{FAPI}/time")
        received = time.time() * 1000
        offset = body["serverTime"] - (sent + received) / 2
        times.append(ms)
        print(f"time {i}: {status} {body}, round trip {ms:.0f} ms, server minus midpoint {offset:.0f} ms")
    print(f"time first {times[0]:.0f} ms, warm min {min(times[1:]):.0f} median {statistics.median(times[1:]):.0f} max {max(times[1:]):.0f} ms")
    status, _, raw, ms = request(f"{FAPI}/time", ua=False)
    print(f"time with no User-Agent: {status}, {raw[:80]!r}")
    status, body, ms, _ = get_json(f"{SAPI}/time")
    print(f"spot time: {status} {body}, {ms:.0f} ms")


def mode_catalog() -> None:
    print("\n# catalog")
    status, rows, ms, size = get_json(f"{FAPI}/contracts")
    (WORK / "contracts.json").write_text(json.dumps(rows))
    print(f"GET /contracts: {status}, {len(rows)} rows, {size} bytes, {ms:.0f} ms")
    for field in ["type", "status", "side", "marginCoin", "openTakerFee", "openMakerFee", "closeTakerFee", "closeMakerFee", "maxLever"]:
        print(field, collections.Counter(str(row.get(field)) for row in rows).most_common(8))
    live = [row for row in rows if is_live(row)]
    print(f"type {TENANT}, side 1, status 1: {len(live)}, quotes {collections.Counter(row['symbol'].rsplit('-', 1)[-1] for row in live)}")
    print("multiplier", collections.Counter(row["multiplier"] for row in live).most_common())
    print(f"not {TENANT}:", [(row["symbol"], row["type"], row["status"], row["marginCoin"]) for row in rows if row.get("type") != TENANT])
    bases = collections.Counter(row["multiplierCoin"] for row in live)
    print("base listed twice:", [base for base, count in bases.items() if count > 1])
    print("base not in symbol:", [(row["symbol"], row["multiplierCoin"]) for row in live if f"-{row['multiplierCoin']}-" not in row["symbol"]])
    print("live bases:", sorted(bases))
    print("BTC row:", next((row for row in live if row["symbol"] == BTC), None))

    print("\nweb list, POST", WEB_INFO)
    for label, body, headers in [
        ("empty body", {}, None),
        ("exchange-language only", {}, {"exchange-language": "en_US"}),
    ]:
        status, parsed, ms, size, raw = web_info(body, headers)
        code = parsed.get("code") if isinstance(parsed, dict) else None
        print(f"{label}: {status}, {size} bytes, {ms:.0f} ms, code {code}, msg {parsed.get('msg') if isinstance(parsed, dict) else raw[:100]!r}")
    status, parsed, ms, size, _ = web_info({}, {"exchange-language": "en_US"})
    data = parsed["data"]
    (WORK / "public-info.json").write_text(json.dumps(parsed))
    listed = data["contractList"]
    print(f"contractList {len(listed)}, wsUrl {data.get('wsUrl')}, marginCoinList {data.get('marginCoinList')}")
    for field in ["contractType", "contractShowType", "deliveryKind", "marginCoin", "originalCoin", "capitalFrequency", "capitalIntervalMax", "capitalIntervalMin", "assetClass", "liquidationRate", "maxLever"]:
        print(field, collections.Counter(str(row.get(field)) for row in listed).most_common(8))
    print("feeRateVo", collections.Counter(json.dumps({k: v for k, v in (row.get("feeRateVo") or {}).items() if k.endswith("Rate")}) for row in listed).most_common(3))
    print("non-E rows:", [(row["contractName"], row["contractType"], row["marginCoin"]) for row in listed if row["contractType"] != "E"])
    open_api = {row["symbol"] for row in live}
    web = {row["contractName"] for row in listed if row["contractType"] == "E"}
    print(f"both lists {len(open_api & web)}, open API only {sorted(open_api - web)}, web only {sorted(web - open_api)}")
    sub_ok = sum(row["subSymbol"] == socket_name(row["contractName"]) for row in listed)
    print(f"subSymbol equals the engine's socket_name rule on {sub_ok} of {len(listed)}")
    hours_utc = collections.Counter(datetime.fromtimestamp(row["nextCapitalSettTime"] / 1000, timezone.utc).strftime("%H:%M") for row in listed)
    print("nextCapitalSettTime as UTC clock time:", hours_utc)

    status, config, ms, size = get_json(CONTRACT_CONFIG)
    (WORK / "contract-config.json").write_text(json.dumps(config))
    rows_c = config["data"]["contractList"]
    print(f"\nGET {CONTRACT_CONFIG}: {status}, code {config.get('code')}, {len(rows_c)} rows, {size} bytes, {ms:.0f} ms")
    for field in ["contractType", "marginCoin", "status", "capitalFrequency", "capitalPremiumMax", "capitalPremiumMin"]:
        print(field, collections.Counter(str(row.get(field)) for row in rows_c).most_common(8))
    print("subSymbol present on", sum(bool(row.get("subSymbol")) for row in rows_c), "rows")
    kept = {row["contractName"] for row in rows_c if row.get("status") in (None, 1)}
    print(f"config rows with status 1 or absent: {len(kept)}, both with open API live {len(kept & open_api)}, config only {sorted(kept - open_api)}, open API only {sorted(open_api - kept)}")
    by_web = {row["contractName"]: row for row in listed}
    differ = [r["contractName"] for r in rows_c if r["contractName"] in by_web and r.get("capitalFrequency") != by_web[r["contractName"]]["capitalFrequency"]]
    print(f"capitalFrequency differs between config and web list on {len(differ)}: {differ[:8]}")

    status, tickers, ms, size = get_json(f"{FAPI}/ticker_all")
    now_ms = time.time() * 1000
    scheduled = {row["subSymbol"] for row in listed if row["contractType"] == "E"}
    ages = {raw: (now_ms - row["time"]) / 86400000 for raw, row in tickers.items() if raw in scheduled}
    stale = sorted((round(age, 2), raw) for raw, age in ages.items() if age > 1)
    zero_vol = sum(tickers[raw]["vol"] in ("0", 0) for raw in ages)
    print(f"\nGET /ticker_all: {status}, {len(tickers)} rows keyed by socket name, {size} bytes, {ms:.0f} ms, {len(ages)} of the {len(scheduled)} web list perpetuals present")
    print(f"ticker time older than a day on {len(stale)}, 24 h vol 0 on {zero_vol}, oldest (days, raw) {stale[-8:]}")

    status, body, ms, size = get_json(f"{SAPI}/symbols")
    symbols = body["symbols"]
    print(f"\nspot GET /sapi/v1/symbols: {status}, {len(symbols)} rows, {size} bytes, quoteAssetName {collections.Counter(row.get('quoteAssetName') for row in symbols).most_common(6)}, first {symbols[0]['symbol']}")


def mode_anchor() -> None:
    print("\n# anchor")
    live = live_contracts()
    started = time.perf_counter()
    replies: dict[str, dict] = {}
    times = []

    def one(symbol: str):
        status, body, ms, size = get_json(f"{FAPI}/index?contractName={symbol}")
        return symbol, status, body, ms, size

    with ThreadPoolExecutor(max_workers=4) as pool:
        for symbol, status, body, ms, size in pool.map(one, [row["symbol"] for row in live]):
            times.append(ms)
            replies[symbol] = body if status == 200 and isinstance(body, dict) else {"status": status}
    round_ms = (time.perf_counter() - started) * 1000
    (WORK / "index-round.json").write_text(json.dumps(replies))
    print(f"/index round over {len(live)} contracts, 4 at a time: {round_ms:.0f} ms, per call min {min(times):.0f} median {statistics.median(times):.0f} max {max(times):.0f} ms")
    print("reply keys", collections.Counter(tuple(sorted(body)) for body in replies.values()).most_common(3))
    print("BTC reply", json.dumps(replies.get(BTC)))
    zero = [s for s, b in replies.items() if not b.get("indexPrice")]
    print(f"index 0 or absent on {len(zero)}: {zero[:10]}")
    same = sum(b.get("currentFundRate") == b.get("nextFundRate") for b in replies.values())
    print(f"currentFundRate equals nextFundRate on {same} of {len(replies)}")
    print("currentFundRate", collections.Counter(b.get("currentFundRate") for b in replies.values()).most_common(5))

    _, gate_rows, _, _ = get_json(GATE)
    gate = {row["contract"]: float(row["index_price"]) for row in gate_rows if row.get("index_price") not in (None, "", "0")}
    gaps = []
    for symbol, body in replies.items():
        if gate_name(symbol) in gate and body.get("indexPrice"):
            gaps.append((abs(body["indexPrice"] / gate[gate_name(symbol)] - 1) * 1e6, symbol))
    gaps.sort()
    if gaps:
        ppm = [gap for gap, _ in gaps]
        print(f"index against Gate's index on {len(gaps)} shared contracts: median {statistics.median(ppm):.0f} ppm, {sum(p <= 1000 for p in ppm)} within 1,000 ppm, {sum(p > 10000 for p in ppm)} beyond 10,000 ppm")
        print("widest 6:", [(symbol, round(gap)) for gap, symbol in gaps[-6:]])
    print("not on Gate:", sorted(s for s in replies if gate_name(s) not in gate))
    for symbol in [f"{TENANT}-CL-USDT", f"{TENANT}-SPX-USDT", f"{TENANT}-PAXG-USDT", f"{TENANT}-XAUT-USDT"]:
        print(f"{symbol}: index {replies.get(symbol, {}).get('indexPrice')}, Gate index {gate.get(gate_name(symbol))}")
    diff = [(s, b["currentFundRate"], b["nextFundRate"]) for s, b in replies.items() if b.get("currentFundRate") != b.get("nextFundRate")]
    print("current and next rate differ:", diff)
    mark_gap = sorted(abs(b["tagPrice"] / b["indexPrice"] - 1) * 1e6 for b in replies.values() if b.get("indexPrice") and b.get("tagPrice"))
    print(f"mark against own index: median {statistics.median(mark_gap):.0f} ppm, max {mark_gap[-1]:.0f} ppm, {sum(g > 10000 for g in mark_gap)} beyond 10,000 ppm")

    print("\n60 one-second polls of", WATCH)
    seen = {symbol: collections.defaultdict(set) for symbol in WATCH}
    poll_ms = []
    for _ in range(60):
        tick = time.perf_counter()
        with ThreadPoolExecutor(max_workers=len(WATCH)) as pool:
            for symbol, status, body, ms, _ in pool.map(one, WATCH):
                poll_ms.append(ms)
                if status == 200 and isinstance(body, dict):
                    for field, value in body.items():
                        seen[symbol][field].add(value)
        time.sleep(max(0.0, 1.0 - (time.perf_counter() - tick)))
    print(f"per call min {min(poll_ms):.0f} median {statistics.median(poll_ms):.0f} max {max(poll_ms):.0f} ms")
    for symbol in WATCH:
        print(symbol, {field: len(values) for field, values in seen[symbol].items()}, "currentFundRate values", sorted(seen[symbol]["currentFundRate"]))


def mode_book() -> None:
    print("\n# book")
    for limit in [None, 5, 20, 100, 200]:
        url = f"{FAPI}/depth?contractName={BTC}" + ("" if limit is None else f"&limit={limit}")
        status, _, raw, ms = request(url)
        body = json.loads(raw)
        bids, asks = body.get("bids", []), body.get("asks", [])
        ordered = all(bids[i][0] > bids[i + 1][0] for i in range(len(bids) - 1)) and all(asks[i][0] < asks[i + 1][0] for i in range(len(asks) - 1))
        print(f"limit {limit}: {status}, {len(bids)} bids, {len(asks)} asks, ordered {ordered}, time {body.get('time')}, {len(raw)} bytes, {ms:.0f} ms, touch {bids[:1]} {asks[:1]}")
    tops = []
    for _ in range(6):
        status, _, raw, _ = request(f"{FAPI}/depth?contractName={TENANT}-ETH-USDT&limit=5")
        body = json.loads(raw)
        tops.append((tuple(body["bids"][0]), tuple(body["asks"][0])))
        time.sleep(0.5)
    print(f"six ETH reads 0.5 s apart: {sum(tops[i] != tops[i + 1] for i in range(5))} of 5 steps changed the touch")
    for name in [BTC.lower(), "E-BTC-USDT", "BTC-USDT", "usdt1858_btcusdt"]:
        status, _, raw, ms = request(f"{FAPI}/depth?contractName={name}&limit=5")
        print(f"contractName {name}: {status}, {raw[:120]!r}")
    books = []
    for row in live_contracts():
        status, _, raw, _ = request(f"{FAPI}/depth?contractName={row['symbol']}&limit=100")
        body = json.loads(raw)
        bids, asks = body.get("bids") or [], body.get("asks") or []
        spread = (asks[0][0] / bids[0][0] - 1) * 1e6 if bids and asks else None
        books.append((row["symbol"], len(bids), len(asks), None if spread is None else round(spread)))
    (WORK / "books.json").write_text(json.dumps(books))
    spreads = sorted(b[3] for b in books if b[3] is not None)
    print(f"books over {len(books)} contracts: levels per side min {min(min(b[1], b[2]) for b in books)}, spread ppm min {spreads[0]}, median {statistics.median(spreads)}, max {spreads[-1]}")
    print("widest 5 (symbol, bids, asks, spread ppm):", sorted(books, key=lambda b: b[3] or 0)[-5:])
    print("BTC, ETH, SOL:", [b for b in books if b[0].split("-")[1] in ("BTC", "ETH", "SOL")])


def mode_errors() -> None:
    print("\n# errors")
    for url in [f"{FAPI}/index?contractName={TENANT}-NOPE-USDT", f"{FAPI}/index", f"{FAPI}/depth?contractName={TENANT}-NOPE-USDT", f"{FAPI}/ticker",
                f"{FAPI}/nope", f"{SAPI}/depth?symbol=nope", f"{FAPI}/funding_rate?contractName={BTC}"]:
        status, headers, raw, ms = request(url)
        limit_headers = {k: v for k, v in headers.items() if "limit" in k.lower() or k.lower() == "retry-after"}
        print(f"GET {url}: {status}, {raw[:160]!r}, rate headers {limit_headers}")
    status, headers, raw, ms = request(f"{FAPI}/time")
    print("headers of /time:", {k: v for k, v in headers.items() if k.lower() not in ("report-to", "nel", "date")})


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    print("run at", datetime.now(timezone.utc).isoformat(timespec="seconds"), "mode", mode)
    modes = {"host": mode_host, "catalog": mode_catalog, "anchor": mode_anchor, "book": mode_book, "errors": mode_errors}
    for name, run in modes.items():
        if mode in (name, "all"):
            run()
    print(f"\nreplies that were not JSON: {len(ODD_REPLIES)}")
    for line in ODD_REPLIES[:10]:
        print("  ", line)


if __name__ == "__main__":
    main()
