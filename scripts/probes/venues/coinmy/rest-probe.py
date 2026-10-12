# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only REST probe for CoinMy, a ChainUp white label whose open API host could not be found.

Modes, each runnable alone: access, catalog, fees, latency, all (the default).
Run from the repository root: uv run scripts/probes/venues/coinmy/rest-probe.py [mode]
Captures go to .claude/survey-work/coinmy/.
"""

import collections
import json
import socket
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WORK = Path(".claude/survey-work/coinmy")
UA = "Mozilla/5.0 (X11; Linux x86_64) survey-probe"
GATEWAY = "https://api.cmgatewayapi.com"  # the web app's axios baseURL
FUT_INFO = f"{GATEWAY}/futures/api/common/public_info"
SPOT_INFO = f"{GATEWAY}/spot/api/common/public_info_v7"
FEE_LIST = f"{GATEWAY}/spot/api/membership/get_level_fee_config_list"
WEB_HEADERS = {"exchange-client": "pc", "exchange-language": "en_US"}  # what the web app sends, without a login token

# Hosts and paths a ChainUp open API would use, from the documentation's openapi.xxx.com and futuresopenapi.xxx.com placeholders.
OPEN_API_CANDIDATES = [
    "https://openapi.coinmy.com/sapi/v1/time",
    "https://futuresopenapi.coinmy.com/fapi/v1/time",
    "https://api.coinmy.com/sapi/v1/time",
    "https://api.coinmy.com/fapi/v1/contracts",
    "https://api.coinmy.com/spot/open/sapi/v1/time",
    "https://api.coinmy.com/futures/open/fapi/v1/time",
    "https://api.cmgatewayapi.com/sapi/v1/time",
    "https://api.cmgatewayapi.com/fapi/v1/contracts",
    "https://api.cmgatewayapi.com/spot/open/sapi/v1/time",
    "https://api.cmgatewayapi.com/futures/open/fapi/v1/time",
    "https://api.cmgatewayapi.com/futures/open/fapi/v1/contracts",
    "https://openapi.cmgatewayapi.com/sapi/v1/time",
    "https://futuresopenapi.cmgatewayapi.com/fapi/v1/time",
]
PAGES = [
    "https://www.coinmy.com/en-us",
    "https://www.coinmy.com/en-us/my-rate",
    "https://www.coinmy.com/en-us/futures/E-BTC-USDT",
    "https://m.coinmy.com/",
]


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def request(url: str, body: dict | None = None, headers: dict | None = None) -> tuple[int, dict, bytes, float]:
    data = None if body is None else json.dumps(body).encode()
    all_headers = {"User-Agent": UA}
    if body is not None:
        all_headers["Content-Type"] = "application/json"
    all_headers.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=all_headers, method="POST" if body is not None else "GET")
    start = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as reply:
            return reply.status, dict(reply.headers), reply.read(), (time.perf_counter() - start) * 1000
    except urllib.error.HTTPError as error:
        return error.code, dict(error.headers), error.read(), (time.perf_counter() - start) * 1000
    except urllib.error.URLError as error:
        return 0, {}, str(error.reason).encode(), (time.perf_counter() - start) * 1000


def resolve(host: str) -> str:
    try:
        return ", ".join(sorted({info[4][0] for info in socket.getaddrinfo(host, 443)}))
    except socket.gaierror as error:
        return f"no address ({error})"


def title(raw: bytes) -> str:
    text = raw.decode(errors="replace")
    start = text.find("<title>")
    return text[start + 7 : text.find("</title>", start)][:90] if start >= 0 else text[:120].replace("\n", " ")


def mode_access() -> None:
    print(f"\n# access, {now()}")
    status, _, raw, _ = request("https://www.cloudflare.com/cdn-cgi/trace")
    trace = dict(line.split("=", 1) for line in raw.decode().splitlines() if "=" in line)
    print(f"exit: ip {trace.get('ip')} loc {trace.get('loc')} colo {trace.get('colo')}")
    for host in ["www.coinmy.com", "m.coinmy.com", "api.coinmy.com", "ws.coinmy.com", "openapi.coinmy.com", "futuresopenapi.coinmy.com", "api.cmgatewayapi.com", "openapi.cmgatewayapi.com"]:
        print(f"dns {host}: {resolve(host)}")
    for url in PAGES:
        status, headers, raw, ms = request(url)
        print(f"page {url}: {status} in {ms:.0f} ms, {len(raw)} bytes, server {headers.get('Server')}, title '{title(raw)}'")
    for url in OPEN_API_CANDIDATES:
        status, headers, raw, ms = request(url)
        print(f"open api {url}: {status} in {ms:.0f} ms, {raw[:110]!r}")
    status, _, raw, ms = request(FUT_INFO, body={}, headers={"exchange-client": "pc"})
    print(f"futures public_info without exchange-language: {status} in {ms:.0f} ms, {len(raw)} bytes, {raw[:80]!r}")
    status, _, raw, ms = request(FUT_INFO, body={}, headers=WEB_HEADERS)
    print(f"futures public_info with exchange-language: {status} in {ms:.0f} ms, {len(raw)} bytes, code {json.loads(raw).get('code')}")
    status, _, raw, ms = request(f"{GATEWAY}/futures/api/common/public_info", headers=WEB_HEADERS)
    print(f"futures public_info as GET: {status}, {raw[:120]!r}")
    status, _, raw, ms = request(f"{GATEWAY}/futures/api/v1/index", headers=WEB_HEADERS)
    print(f"unknown futures path: {status}, {raw[:120]!r}")


def mode_catalog() -> None:
    print(f"\n# catalog, {now()}")
    status, _, raw, ms = request(FUT_INFO, body={}, headers=WEB_HEADERS)
    (WORK / "fut-public-info.json").write_bytes(raw)
    data = json.loads(raw)["data"]
    contracts = data["contractList"]
    print(f"futures public_info: {status}, {len(raw)} bytes in {ms:.0f} ms, wsUrl {data['wsUrl']}, marginCoinList {data['marginCoinList']}, server time {data['currentTimeMillis']}")
    print(f"contracts {len(contracts)}")
    for key in ["contractType", "contractSide", "marginCoin", "deliveryKind", "capitalFrequency", "settlementFrequency", "classification", "brokerId"]:
        print(f"  {key}: {dict(collections.Counter(c[key] for c in contracts))}")
    stamps = collections.Counter(datetime.fromtimestamp(c["nextCapitalSettTime"] / 1000, timezone.utc).isoformat() for c in contracts)
    print(f"  nextCapitalSettTime: {dict(stamps)}, server time {datetime.fromtimestamp(data['currentTimeMillis'] / 1000, timezone.utc).isoformat()}")
    print(f"  subSymbol is e_ plus lower case base and quote on {sum(c['subSymbol'] == 'e_' + (c['base'] + c['quote']).lower() for c in contracts)} of {len(contracts)}")
    print(f"  contractName is E-base-quote on {sum(c['contractName'] == 'E-' + c['base'] + '-' + c['quote'] for c in contracts)} of {len(contracts)}")
    print(f"  multiplierCoin equals base on {sum(c['multiplierCoin'] == c['base'] for c in contracts)} of {len(contracts)}")
    print(f"  first depthList step equals 10^-symbolPricePrecision on {sum(float(c['coinResultVo']['depthList'][0]) == 10 ** -c['coinResultVo']['symbolPricePrecision'] for c in contracts)} of {len(contracts)}")
    print(f"  maxLever: {dict(collections.Counter(c['maxLever'] for c in contracts))}")
    print("  names: " + " ".join(sorted(c["contractName"] for c in contracts)))
    print("  multipliers: " + " ".join(f"{c['contractName']}={c['multiplier']}" for c in sorted(contracts, key=lambda c: c["contractName"])))
    print(f"  contractProInfo {data.get('contractProInfo')}")

    status, _, raw, ms = request(SPOT_INFO, body={}, headers=WEB_HEADERS)
    (WORK / "spot-public-info.json").write_bytes(raw)
    data = json.loads(raw)["data"]
    market = data["market"]
    pairs = [p for quote in market["market"].values() for p in quote.values()]
    print(f"spot public_info_v7: {status}, {len(raw)} bytes in {ms:.0f} ms, wsUrl {market['wsUrl']}, quotes {list(market['market'])}, pairs {len(pairs)}")
    print(f"  isShow: {dict(collections.Counter(p['isShow'] for p in pairs))}, is_open_lever: {dict(collections.Counter(p['is_open_lever'] for p in pairs))}")
    print(f"  quoteFeeRate: {dict(collections.Counter(p.get('quoteFeeRate') for p in pairs))}")
    print("  pairs: " + " ".join(sorted(p["name"] for p in pairs)))
    print("  symbol and depth steps: " + " ".join(f"{p['symbol']}[{p['depth']}]" for p in sorted(pairs, key=lambda p: p["symbol"])[:6]))
    print(f"  limitCountryList {data.get('limitCountryList')}, open_api_url {data.get('open_api_url')}, fee_coin_rate {data.get('fee_coin_rate')}")


def mode_fees() -> None:
    print(f"\n# fees, {now()}")
    for kind, label in [(1, "spot"), (2, "futures")]:
        status, _, raw, ms = request(FEE_LIST, body={"type": kind}, headers=WEB_HEADERS)
        (WORK / f"fees-type{kind}.json").write_bytes(raw)
        data = json.loads(raw)["data"]
        cond = data["condition"]
        print(f"{label} (type {kind}): {status} in {ms:.0f} ms, condition firstKey {cond['firstKey']} secondKey {cond['secondKey']} rule {cond['rule']} platformOpen {cond['platformOpen']} platformRate {cond['platformRate']} saveDays {cond['saveDays']}")
        for row in data["list"]:
            print(f"  {row['levelName']:<13} maker {row['maker'] * 100:.4f}% ({row['maker'] * 1e6:.0f} ppm) taker {row['taker'] * 100:.4f}% ({row['taker'] * 1e6:.0f} ppm) {row['firstKey']} {row['compareRule']} {row['firstValue']} or {row['secondKey']} {row['secondValue']}")
    status, _, raw, ms = request(FEE_LIST, body={}, headers=WEB_HEADERS)
    print(f"no type: {status}, {raw[:120]!r}")


def mode_latency() -> None:
    print(f"\n# latency, {now()}")
    cold = request(FUT_INFO, body={}, headers=WEB_HEADERS)
    warm = [request(FUT_INFO, body={}, headers=WEB_HEADERS) for _ in range(10)]
    times = sorted(r[3] for r in warm)
    print(f"futures public_info cold {cold[3]:.0f} ms, warm median {statistics.median(times):.0f} ms, p90 {times[8]:.0f} ms, statuses {collections.Counter(r[0] for r in warm)}")
    print(f"headers: server {cold[1].get('Server')}, cf-ray {cold[1].get('CF-RAY') or cold[1].get('cf-ray')}, cache {cold[1].get('cf-cache-status')}")


MODES = {"access": mode_access, "catalog": mode_catalog, "fees": mode_fees, "latency": mode_latency}

if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    chosen = sys.argv[1] if len(sys.argv) > 1 else "all"
    for name, fn in MODES.items():
        if chosen in (name, "all"):
            fn()
