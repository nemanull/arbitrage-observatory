# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for the idax futures open API, a ChainUp white label.

Modes, each runnable alone: host, catalog, anchor, book, errors, all (the default).
Run from the repository root: uv run scripts/probes/venues/idax/rest-probe.py [mode]
Captures go to .claude/survey-work/idax/.
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

WORK = Path(".claude/survey-work/idax")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
FAPI = "https://futuresopenapi.idax.exchange/fapi/v1"
SAPI = "https://openapi.idax.exchange/sapi/v1"
CONTRACT_CONFIG = "https://futuresopenapi.idax.exchange/v1/inner/contract_config"
WEB_INFO = "https://futures.idax.exchange/fe-co-api/common/public_info"
GATE = "https://api.gateio.ws/api/v4/futures/usdt/tickers"
WEB_HEADERS = {"exchange-client": "pc", "exchange-language": "en_US", "futures-version": "101"}  # what the web app sends
WATCH = ["E-BTC-USDT", "E-ETH-USDT", "E-SOL-USDT", "E-TSLA-USDT", "E-XAU-USDT"]


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


ODD_REPLIES: list[str] = []  # replies that were not JSON, kept so a run reports them instead of stopping


def get_json(url: str):
    status, headers, raw, ms = request(url)
    try:
        return status, json.loads(raw), ms, len(raw)
    except ValueError:
        ODD_REPLIES.append(f"{url} {status} {len(raw)} bytes, content-type {headers.get('Content-Type')}, retry-after {headers.get('Retry-After')}, {raw[:200]!r}")
        return status, None, ms, len(raw)


def ua_time() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def web_info(body: dict, headers: dict | None = None):
    status, _, raw, ms = request(WEB_INFO, body, headers)
    try:
        parsed = json.loads(raw)
    except ValueError:
        parsed = None
    return status, parsed, ms, len(raw), raw


def live_contracts() -> list[dict]:
    _, rows, _, _ = get_json(f"{FAPI}/contracts")
    return [row for row in rows if row.get("type") == "E" and row.get("status") == 1]


def mode_host() -> None:
    print("\n# host")
    for host in ["futuresopenapi.idax.exchange", "futuresws.idax.exchange", "futures.idax.exchange", "openapi.idax.exchange", "www.idax.exchange", "api.idax.exchange"]:
        try:
            addrs = sorted({info[4][0] for info in socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)})
        except socket.gaierror as error:
            addrs = [f"no address: {error}"]
        print(f"{host}: {addrs}")
    for url in ["https://www.idax.exchange/", f"{SAPI}/ping", f"{FAPI}/ping", "https://openapi.idax.exchange/"]:
        status, headers, raw, ms = request(url)
        print(f"GET {url}: {status}, {len(raw)} bytes, {ms:.0f} ms, location {headers.get('Location')}, cf-ray {headers.get('CF-RAY') or headers.get('cf-ray')}, body {raw[:120]!r}")
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


def mode_catalog() -> None:
    print("\n# catalog")
    status, rows, ms, size = get_json(f"{FAPI}/contracts")
    (WORK / "contracts.json").write_text(json.dumps(rows))
    print(f"GET /contracts: {status}, {len(rows)} rows, {size} bytes, {ms:.0f} ms")
    for field in ["type", "status", "side", "marginCoin"]:
        print(field, collections.Counter(str(row.get(field)) for row in rows).most_common())
    live = [row for row in rows if row.get("type") == "E" and row.get("status") == 1]
    print(f"type E, status 1: {len(live)}, quotes {collections.Counter(row['symbol'].rsplit('-', 1)[-1] for row in live)}")
    print("multiplier", collections.Counter(row["multiplier"] for row in live).most_common())
    print("not E:", [(row["symbol"], row["type"], row["status"]) for row in rows if row.get("type") != "E"])
    bases = collections.Counter(row["multiplierCoin"] for row in live)
    print("base listed twice:", [base for base, count in bases.items() if count > 1])
    print("base not in symbol:", [(row["symbol"], row["multiplierCoin"]) for row in live if f"-{row['multiplierCoin']}-" not in row["symbol"]])
    print("bundle names:", sorted(row["symbol"] for row in live if row["symbol"].split("-")[1][:4] in ("1000", "1000")))

    print("\nweb list, POST", WEB_INFO)
    for label, body, headers in [
        ("empty body", {}, None),
        ("uaTime only", {"uaTime": ua_time()}, None),
        ("web headers, empty body", {}, {"exchange-client": "pc", "exchange-language": "en_US", "futures-version": "101"}),
        ("web headers and uaTime", {"uaTime": ua_time()}, {"exchange-client": "pc", "exchange-language": "en_US", "futures-version": "101"}),
        ("exchange-client only", {}, {"exchange-client": "pc"}),
        ("exchange-language only", {}, {"exchange-language": "en_US"}),
        ("futures-version only", {}, {"futures-version": "101"}),
    ]:
        status, parsed, ms, size, raw = web_info(body, headers)
        code = parsed.get("code") if isinstance(parsed, dict) else None
        print(f"{label}: {status}, {size} bytes, {ms:.0f} ms, code {code}, msg {parsed.get('msg') if isinstance(parsed, dict) else raw[:100]!r}")
    status, parsed, ms, size, _ = web_info({}, WEB_HEADERS)
    data = parsed["data"]
    (WORK / "public-info.json").write_text(json.dumps(parsed))
    listed = data["contractList"]
    print(f"contractList {len(listed)}, wsUrl {data.get('wsUrl')}, marginCoinList {data.get('marginCoinList')}, currentTimeMillis {data.get('currentTimeMillis')}")
    for field in ["contractType", "contractSide", "marginCoin", "capitalFrequency", "nextCapitalSettTime", "settlementFrequency", "deliveryKind", "liquidationRate", "classification", "assetClass", "capitalIntervalMax"]:
        print(field, collections.Counter(row.get(field) for row in listed).most_common())
    print("capitalFrequencyUnit", collections.Counter(str(row.get("capitalFrequencyUnit")) for row in listed))
    perps = [row for row in listed if row["contractType"] == "E"]
    for cls in sorted({row["assetClass"] for row in perps}):
        members = [row["base"] for row in perps if row["assetClass"] == cls]
        print(f"assetClass {cls} among type E: {len(members)}, {members[:12]}")
    print("S row:", [(row["contractName"], row["marginCoin"], row["assetClass"]) for row in listed if row["contractType"] != "E"])
    open_api = {row["symbol"] for row in live}
    web = {row["contractName"] for row in listed}
    print(f"both lists {len(open_api & web)}, open API only {sorted(open_api - web)}, web only {sorted(web - open_api)}")
    sub_ok = sum(row["subSymbol"] == row["contractName"].lower().replace("-", "_", 1).replace("-", "") for row in listed)
    print(f"subSymbol equals the lowered contract name with one underscore on {sub_ok} of {len(listed)}")
    hours_utc = collections.Counter(datetime.fromtimestamp(row["nextCapitalSettTime"] / 1000, timezone.utc).strftime("%H:%M") for row in listed)
    print("nextCapitalSettTime as UTC clock time:", hours_utc)

    status, config, ms, size = get_json(CONTRACT_CONFIG)
    (WORK / "contract-config.json").write_text(json.dumps(config))
    rows = config["data"]["contractList"]
    print(f"\nGET {CONTRACT_CONFIG}: {status}, code {config.get('code')}, {len(rows)} rows, {size} bytes, {ms:.0f} ms")
    for field in ["contractType", "contractSide", "marginCoin", "status", "capitalFrequency", "nextCapitalSettTime"]:
        print(field, collections.Counter(str(row.get(field)) for row in rows).most_common())
    print("subSymbol present on", sum(bool(row.get("subSymbol")) for row in rows), "rows, capitalFrequencyUnit", collections.Counter(str(row.get("capitalFrequencyUnit")) for row in rows))
    kept = {row["contractName"] for row in rows if row.get("status") in (None, 1) and row.get("contractType") == "E"}
    print(f"config E rows, status 1 or absent: {len(kept)}, against open API live: both {len(kept & open_api)}, config only {sorted(kept - open_api)[:12]}, open API only {sorted(open_api - kept)}")
    by_name = {row["contractName"]: row for row in rows}
    differ = [name for name in web if name in by_name and by_name[name].get("capitalFrequency") != next(r for r in listed if r["contractName"] == name)["capitalFrequency"]]
    print(f"capitalFrequency differs between config and web list on {len(differ)}: {differ[:8]}")

    status, tickers, ms, size = get_json(f"{FAPI}/ticker_all")
    now_ms = time.time() * 1000
    scheduled = {row["subSymbol"] for row in listed if row["contractType"] == "E"}
    ages = {raw: (now_ms - row["time"]) / 86400000 for raw, row in tickers.items() if raw in scheduled}
    stale = sorted((round(age), raw) for raw, age in ages.items() if age > 1)
    zero_vol = sum(tickers[raw]["vol"] in ("0", 0) for raw in ages)
    print(f"\nGET /ticker_all: {status}, {len(tickers)} rows keyed by socket name, {size} bytes, {ms:.0f} ms, {len(ages)} of the {len(scheduled)} web list perpetuals present")
    print(f"ticker time older than a day on {len(stale)}, 24 h vol 0 on {zero_vol}, oldest (days, raw) {stale[-8:]}")

    status, body, ms, size = get_json(f"{SAPI}/symbols")
    symbols = body["symbols"]
    print(f"\nspot GET /sapi/v1/symbols: {status}, {len(symbols)} rows, {size} bytes, quotes {collections.Counter(row.get('quoteAsset') for row in symbols).most_common(6)}")


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
            replies[symbol] = body if status == 200 else {"status": status}
    round_ms = (time.perf_counter() - started) * 1000
    (WORK / "index-round.json").write_text(json.dumps(replies))
    print(f"/index round over {len(live)} contracts, 4 at a time: {round_ms:.0f} ms, per call min {min(times):.0f} median {statistics.median(times):.0f} max {max(times):.0f} ms")
    print("reply keys", collections.Counter(tuple(sorted(body)) for body in replies.values()).most_common(3))
    print("BTC reply", json.dumps(replies.get("E-BTC-USDT")))
    zero = [s for s, b in replies.items() if not b.get("indexPrice")]
    print(f"index 0 or absent on {len(zero)}: {zero[:10]}")
    same = sum(b.get("currentFundRate") == b.get("nextFundRate") for b in replies.values())
    print(f"currentFundRate equals nextFundRate on {same} of {len(replies)}")
    print("currentFundRate", collections.Counter(b.get("currentFundRate") for b in replies.values()).most_common(5))

    _, gate_rows, _, _ = get_json(GATE)
    gate = {row["contract"]: float(row["index_price"]) for row in gate_rows if row.get("index_price") not in (None, "", "0")}
    gaps = []
    for symbol, body in replies.items():
        gate_name = symbol[2:].replace("-", "_")
        if gate_name in gate and body.get("indexPrice"):
            gaps.append((abs(body["indexPrice"] / gate[gate_name] - 1) * 1e6, symbol))
    gaps.sort()
    if gaps:
        ppm = [gap for gap, _ in gaps]
        print(f"index against Gate's index on {len(gaps)} shared contracts: median {statistics.median(ppm):.0f} ppm, {sum(p <= 1000 for p in ppm)} within 1,000 ppm, {sum(p > 10000 for p in ppm)} beyond 10,000 ppm")
        print("widest 8:", [(symbol, round(gap)) for gap, symbol in gaps[-8:]])
    mark_gap = sorted(abs(b["tagPrice"] / b["indexPrice"] - 1) * 1e6 for b in replies.values() if b.get("indexPrice") and b.get("tagPrice"))
    print(f"mark against own index: median {statistics.median(mark_gap):.0f} ppm, max {mark_gap[-1]:.0f} ppm, {sum(g > 10000 for g in mark_gap)} beyond 10,000 ppm")
    wide_mark = sorted(((abs(b["tagPrice"] / b["indexPrice"] - 1) * 1e6, s) for s, b in replies.items() if b.get("indexPrice") and b.get("tagPrice")))[-6:]
    print("widest mark gaps:", [(s, round(g), replies[s]["indexPrice"], replies[s]["tagPrice"]) for g, s in wide_mark])
    multipliers = {row["symbol"]: row["multiplier"] for row in live}
    for symbol in ["E-SHIB-USDT", "E-PEPE-USDT", "E-MAGIC-USDT", "E-ANTHROPIC-USDT"]:
        gate_name = symbol[2:].replace("-", "_")
        _, ticker, _, _ = get_json(f"{FAPI}/ticker?contractName={symbol}")
        print(f"{symbol}: index {replies.get(symbol, {}).get('indexPrice')}, mark {replies.get(symbol, {}).get('tagPrice')}, last {ticker.get('last') if isinstance(ticker, dict) else ticker}, multiplier {multipliers.get(symbol)}, Gate index {gate.get(gate_name)}")

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
        print(symbol, {field: len(values) for field, values in seen[symbol].items()})


def mode_book() -> None:
    print("\n# book")
    for limit in [None, 5, 20, 100, 200, 1000]:
        url = f"{FAPI}/depth?contractName=E-BTC-USDT" + ("" if limit is None else f"&limit={limit}")
        status, _, raw, ms = request(url)
        body = json.loads(raw)
        bids, asks = body.get("bids", []), body.get("asks", [])
        ordered = all(bids[i][0] > bids[i + 1][0] for i in range(len(bids) - 1)) and all(asks[i][0] < asks[i + 1][0] for i in range(len(asks) - 1))
        print(f"limit {limit}: {status}, {len(bids)} bids, {len(asks)} asks, ordered {ordered}, time {body.get('time')}, {len(raw)} bytes, {ms:.0f} ms, touch {bids[:1]} {asks[:1]}")
    tops = []
    for _ in range(6):
        status, _, raw, _ = request(f"{FAPI}/depth?contractName=E-ETH-USDT&limit=5")
        body = json.loads(raw)
        tops.append((tuple(body["bids"][0]), tuple(body["asks"][0])))
        time.sleep(0.5)
    print(f"six ETH reads 0.5 s apart: {sum(tops[i] != tops[i + 1] for i in range(5))} of 5 steps changed the touch")
    status, _, raw, ms = request(f"{FAPI}/depth?contractName=e-btc-usdt&limit=5")
    print(f"lower case contract name: {status}, {raw[:120]!r}")
    status, _, raw, ms = request(f"{FAPI}/depth?contractName=BTC-USDT&limit=5")
    print(f"BTC-USDT without E-: {status}, {raw[:120]!r}")
    live = live_contracts()
    by_cls = {}
    info = json.loads((WORK / "public-info.json").read_text())["data"]["contractList"] if (WORK / "public-info.json").exists() else []
    for row in info:
        by_cls.setdefault(row["assetClass"], row["contractName"])
    thin = []
    for symbol in [row["symbol"] for row in live][-6:] + list(by_cls.values()):
        status, _, raw, _ = request(f"{FAPI}/depth?contractName={symbol}&limit=100")
        body = json.loads(raw)
        bids, asks = body.get("bids") or [], body.get("asks") or []
        spread = (asks[0][0] / bids[0][0] - 1) * 1e6 if bids and asks else None
        thin.append((symbol, len(bids), len(asks), None if spread is None else round(spread)))
    print("books (symbol, bids, asks, spread ppm):", thin)


def mode_errors() -> None:
    print("\n# errors")
    for url in [f"{FAPI}/index?contractName=E-NOPE-USDT", f"{FAPI}/index", f"{FAPI}/depth?contractName=E-NOPE-USDT", f"{FAPI}/ticker", f"{FAPI}/nope", f"{SAPI}/depth?symbol=nope"]:
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
