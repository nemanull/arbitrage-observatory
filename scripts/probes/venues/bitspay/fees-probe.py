# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Read-only probe of the trading fees Bitspay publishes through its public API, and of the listings that say whether it offers perpetuals.

It reads three Bitspay calls that carry fee fields, the CoinMarketCap exchange record and its perpetual pair list, and CoinGecko's exchange records.
Nine GET requests in total.

Run with: uv run scripts/probes/venues/bitspay/fees-probe.py
"""

import json
import time
import urllib.error
import urllib.request
from collections import Counter

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) arbitrage-observatory-probe"}


def log(*a):
    print(*a, flush=True)


def jget(url: str):
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            status, body = r.status, r.read()
    except urllib.error.HTTPError as e:
        status, body = e.code, e.read()
    time.sleep(0.5)
    try:
        return status, json.loads(body), body
    except Exception:
        return status, None, body


def ppm(x) -> int:
    return round(float(x) * 1_000_000)


def main():
    s, d, _ = jget("https://apiv2.bitspay.io/assets/all")
    rows = d["result"]
    c = Counter((ppm(v["maker_fee"]), ppm(v["taker_fee"])) for v in rows.values())
    log(f"assets/all status {s}: {len(rows)} assets, (maker ppm, taker ppm) counts {dict(c)}")

    s, d, _ = jget("https://apiv2.bitspay.io/ticker/all")
    t = d["marketdetails"]
    c = Counter((ppm(x["buyfee"]), ppm(x["sellfee"])) for x in t)
    log(f"ticker/all status {s}: {len(t)} pairs, (buyfee ppm, sellfee ppm) counts {dict(c)}, market_type {dict(Counter(x.get('market_type') for x in t))}")

    s, d, _ = jget("https://apiv2.bitspay.io/getVendorInfo/")
    v = d["vendors"]
    c = Counter((ppm(x["vendors_buypricefee"]), ppm(x["vendors_salepricefee"])) for x in v)
    log(f"getVendorInfo/ status {s}: {len(v)} vendors, (buy fee ppm, sale fee ppm) counts {dict(c)}")
    log(f"getVendorInfo/ fields: {sorted(v[0].keys())}")

    s, d, _ = jget("https://api.coinmarketcap.com/data-api/v3/exchange/detail?slug=bitspay")
    x = d["data"]
    log(f"CoinMarketCap detail status {s}: id {x['id']}, status {x['status']}, makerFee {x['makerFee']}, takerFee {x['takerFee']}, fee url {x['urls'].get('fee')}")
    log(f"CoinMarketCap description: {x['description']}")
    log(f"CoinMarketCap tags: {[t['name'] for t in x.get('tags', [])]}")
    q = x["quote"].get("2781", {})
    log(f"CoinMarketCap volumes in USD: spot {q.get('spotVolume24h')}, perpetual {q.get('perpetualVolume24h')}, futures {q.get('futuresVolume24h')}")

    for cat in ["spot", "perpetual", "futures"]:
        s, d, _ = jget(f"https://api.coinmarketcap.com/data-api/v3/exchange/market-pairs/latest?slug=bitspay&category={cat}&start=1&limit=100")
        log(f"CoinMarketCap market pairs category={cat}: status {s}, numMarketPairs {d['data'].get('numMarketPairs')}")

    for path in ["exchanges/bitspay", "derivatives/exchanges/bitspay"]:
        s, d, body = jget(f"https://api.coingecko.com/api/v3/{path}")
        log(f"CoinGecko {path}: status {s}, body {body[:80]!r}")


if __name__ == "__main__":
    main()
