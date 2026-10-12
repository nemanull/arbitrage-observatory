# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""KTX anchor freshness probe for docs/profiles/ktx/rest.md sections 3, 4 and 8.

Read-only and unauthenticated.
It reads the two bulk anchor calls with and without a cache-busting query parameter, about 30 requests at no more than 1 per second.
It also reads Binance's public premiumIndex once, to test whether KTX copies Binance's funding rate.
Run from the repository root with: uv run scripts/probes/venues/ktx/anchor-probe.py
"""

import http.client
import json
import ssl
import statistics
import time
import urllib.error
import urllib.request

HOST = "api.ktx.com"
UA = {"User-Agent": "arbitrage-observatory-probe/1.0", "Accept": "application/json"}
CONN = http.client.HTTPSConnection(HOST, 443, timeout=20, context=ssl.create_default_context())


def get(path: str):
    t0 = time.perf_counter()
    CONN.request("GET", path, headers=UA)
    resp = CONN.getresponse()
    body = resp.read()
    dt = time.perf_counter() - t0
    time.sleep(1.0)
    return {k.lower(): v for k, v in resp.getheaders()}, json.loads(body), len(body), dt


def section(title: str) -> None:
    print(f"\n=== {title}", flush=True)


def products(bust: bool):
    q = f"&_={time.time_ns() // 1_000_000}" if bust else ""
    h, d, n, dt = get(f"/api/v1/products?market=lpc{q}")
    rows = {r["symbol"]: r for r in d["result"]}
    newest = max(int(r["time"]) for r in rows.values())
    btc = rows["BTC_USDT_SWAP"]
    print(f"products?market=lpc{' with buster' if bust else ''}: cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, {n} bytes in {1000 * dt:.0f} ms, newest row time {time.time() - newest / 1000:.1f} s old, BTC row time {time.time() - int(btc['time']) / 1000:.1f} s old, BTC markPrice {btc['markPrice']}")
    return rows


def contracts(bust: bool):
    q = f"?_={time.time_ns() // 1_000_000}" if bust else ""
    h, d, n, dt = get(f"/api/v1/pu/contracts{q}")
    rows = {r["ticker_id"]: r for r in d["result"]}
    print(f"pu/contracts{' with buster' if bust else ''}: cf-cache-status {h.get('cf-cache-status')}, age {h.get('age')}, cache-control {h.get('cache-control')}, x-ratelimit {h.get('x-ratelimit-limit')}/{h.get('x-ratelimit-remaining')}/{h.get('x-ratelimit-reset')}, {n} bytes in {1000 * dt:.0f} ms, BTC index_price {rows['BTC_USDT_SWAP']['index_price']}")
    return rows


def main() -> None:
    print(f"probe start {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    section("bulk catalog with mark and funding, three plain reads then three with a cache-busting parameter")
    for bust in (False, False, False, True, True, True):
        products(bust)
    section("contracts summary with index and funding, three plain reads then three with a cache-busting parameter")
    for bust in (False, False, False, True, True, True):
        contracts(bust)
    section("fresh products markPrice against fresh pu/contracts index_price, read back to back, three rounds")
    reads = []
    for _ in range(3):
        p = products(True)
        reads.append(p)
        c = contracts(True)
        active = [s for s in p if p[s]["active"] == 1]
        same = sum(1 for s in active if p[s]["markPrice"] == c[s]["index_price"])
        devs = [abs(float(p[s]["markPrice"]) / float(c[s]["index_price"]) - 1) * 1e6 for s in active if float(c[s]["index_price"]) > 0]
        rate_same = sum(1 for s in active if p[s]["fundingRate"] == c[s]["funding_rate"])
        print(f"  active {len(active)}: markPrice equal to index_price {same}, median gap {statistics.median(devs):.0f} ppm, largest {max(devs):.0f} ppm, fundingRate equal to funding_rate {rate_same}")
    section("funding fields across the fresh catalog reads of this run")
    first, last = reads[0], reads[-1]
    act = [s for s in first if first[s]["active"] == 1]
    print(f"reads span {(int(last['BTC_USDT_SWAP']['time']) - int(first['BTC_USDT_SWAP']['time'])) / 1000:.0f} s")
    print(f"active contracts whose fundingRate changed: {sum(1 for s in act if first[s]['fundingRate'] != last[s]['fundingRate'])}, predictedFundingRate changed: {sum(1 for s in act if first[s]['predictedFundingRate'] != last[s]['predictedFundingRate'])}")
    for s in [s for s in act if first[s]["fundingRate"] != last[s]["fundingRate"]][:5]:
        print(f"  {s}: fundingRate {first[s]['fundingRate']} to {last[s]['fundingRate']}, predicted {first[s]['predictedFundingRate']} to {last[s]['predictedFundingRate']}")
    differ = [s for s in act if last[s]["fundingRate"] != last[s]["predictedFundingRate"]]
    print(f"active contracts where fundingRate differs from predictedFundingRate: {len(differ)}")
    for s in differ[:5]:
        print(f"  {s}: fundingRate {last[s]['fundingRate']} predicted {last[s]['predictedFundingRate']} followFundingRate {last[s]['followFundingRate']}")

    section("KTX fundingRate against Binance USD-M lastFundingRate, one read of fapi.binance.com/fapi/v1/premiumIndex")
    try:
        req = urllib.request.Request("https://fapi.binance.com/fapi/v1/premiumIndex", headers=UA)
        with urllib.request.urlopen(req, timeout=20) as resp:
            bn = {r["symbol"]: r for r in json.loads(resp.read())}
        ktx = reads[-1]
        for follow in (1, 0):
            shared = [s for s in act if ktx[s]["followFundingRate"] == follow and s.replace("_USDT_SWAP", "USDT") in bn]
            equal = [s for s in shared if abs(float(ktx[s]["fundingRate"]) - float(bn[s.replace("_USDT_SWAP", "USDT")]["lastFundingRate"])) < 1e-9]
            near = [s for s in shared if abs(float(ktx[s]["fundingRate"]) - float(bn[s.replace("_USDT_SWAP", "USDT")]["lastFundingRate"])) <= 2e-6]
            print(f"followFundingRate {follow}: {len(shared)} active contracts also on Binance, fundingRate equal to Binance lastFundingRate on {len(equal)}, within 0.000002 on {len(near)}")
            for s in [x for x in shared if x not in equal][:3]:
                print(f"  unequal {s}: KTX {ktx[s]['fundingRate']} Binance {bn[s.replace('_USDT_SWAP', 'USDT')]['lastFundingRate']}")
    except urllib.error.HTTPError as exc:
        print(f"Binance refused: {exc.code} {exc.read()[:200]!r}")
    except OSError as exc:
        print(f"Binance unreachable: {exc}")

    section("fresh BTC_USDT_SWAP mark against the fresh REST book mid")
    for _ in range(3):
        p = products(True)
        h, d, n, dt = get(f"/api/v1/order_book?market=lpc&symbol=BTC_USDT_SWAP&level=1&_={time.time_ns() // 1_000_000}")
        mid = (float(d["result"]["b"][0][0]) + float(d["result"]["a"][0][0])) / 2
        mark = float(p["BTC_USDT_SWAP"]["markPrice"])
        print(f"  mark {mark}, mid {mid}, mark minus mid {1e6 * (mark / mid - 1):.0f} ppm")


if __name__ == "__main__":
    main()
